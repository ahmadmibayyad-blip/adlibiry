import { v } from "convex/values";
import { httpAction, internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessToken, errorText, sallaFetch } from "./sallaOrders";
import {
  ADDRESS_WINDOW_MS, AUTO_CANCEL_AFTER_MS, CONFIRM_TEMPLATE, GRAPH_API, REMINDER_DELAYS_MS, REPLIES,
  addressNote, answerButtons, answerButtonsWith, confirmMessage, locationRequest, parseAnyPayload, parseWaWebhook, phoneHash,
  shopifyButtonPayload, textMessage,
  verifyMetaSignature, waNumber, type Tap,
} from "./lib/whatsapp";

// The WhatsApp half of the COD flow: after hold() (convex/sallaOrders.ts) the customer
// gets the confirm template, reminders at +2 h and +24 h, and the order is cancelled
// a day after the last one with no answer. Taps arrive at /whatsapp/webhook.
// "تعديل العنوان" (templates in ADDRESS_BUTTON_TEMPLATES) keeps the order pending and asks
// for a pin or a typed address, which goes into the order's history in Salla (not stored here).
// One sender for now (Meta Embedded Signup per store comes later). Convex env:
// WHATSAPP_TOKEN (system user token), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET
// (signs the webhook), WHATSAPP_VERIFY_TOKEN (webhook setup), optional
// WHATSAPP_TEMPLATE / WHATSAPP_TEMPLATE_LANG (default cod_order_confirm / ar).
// The customer's number is read from Salla when sending and never stored.
// The webhook below is shared with Istilam for Shopify: `shp:` payloads, failures and addresses
// of Shopify orders go to convex/shopifyCodWhatsapp.ts.

type Ans = "confirmed" | "cancelled";
const answer = v.union(v.literal("confirmed"), v.literal("cancelled"));

export function sender() {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  return token && phoneNumberId ? { token, phoneNumberId } : null;
}

export async function waSend(s: { token: string; phoneNumberId: string }, body: unknown): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${s.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { code?: number; message?: string } };
  if (!res.ok || !data.messages?.[0]?.id) {
    throw new Error(`WhatsApp send failed (${res.status}${data.error ? `, ${data.error.code}: ${data.error.message}` : ""})`);
  }
  return data.messages[0].id;
}

export const order = internalQuery({
  args: { merchantId: v.number(), orderId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", args.merchantId).eq("orderId", args.orderId))
      .unique(),
});

export const saveStoreName = internalMutation({
  args: { merchantId: v.number(), name: v.string() },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    if (s) await ctx.db.patch("sallaStores", s._id, { storeName: args.name });
  },
});

export const recordSent = internalMutation({
  args: { merchantId: v.number(), orderId: v.string(), phoneHash: v.string(), waMessageId: v.string(), reminder: v.number() },
  handler: async (ctx, { merchantId, orderId, reminder, ...fields }) => {
    const o = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", merchantId).eq("orderId", orderId))
      .unique();
    if (o) await ctx.db.patch("sallaCodOrders", o._id, { ...fields, reminders: reminder, sentAt: Date.now(), lastError: undefined });
  },
});

type ClaimArgs = { merchantId: number; orderId: string; answer: Ans; fromHash?: string; note?: string };

/**
 * Takes the customer's answer once: only from the number the message went to (`fromHash`, omitted
 * for the no-answer cancel) and only while the order is pending. Writes it to Salla when taken.
 */
async function claim(ctx: MutationCtx, { merchantId, orderId, answer, fromHash, note }: ClaimArgs): Promise<"taken" | "already" | "ignored"> {
  const o = await ctx.db
    .query("sallaCodOrders")
    .withIndex("by_merchant_order", (q) => q.eq("merchantId", merchantId).eq("orderId", orderId))
    .unique();
  if (!o || (fromHash !== undefined && o.phoneHash !== fromHash)) return "ignored";
  if (o.status !== "pending") return "already";
  await ctx.db.patch("sallaCodOrders", o._id, { status: answer, answeredAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.sallaOrders.decide, { merchantId, orderId, decision: answer, note });
  return "taken";
}

export const claimAnswer = internalMutation({
  args: { merchantId: v.number(), orderId: v.string(), answer, fromHash: v.string() },
  handler: (ctx, args) => claim(ctx, args),
});

/** The address button: the order stays pending and waits for a text or pin from the same number. */
export const askAddress = internalMutation({
  args: { merchantId: v.number(), orderId: v.string(), fromHash: v.string() },
  handler: async (ctx, { merchantId, orderId, fromHash }): Promise<"asked" | "already" | "ignored"> => {
    const o = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", merchantId).eq("orderId", orderId))
      .unique();
    if (!o || o.phoneHash !== fromHash) return "ignored";
    if (o.status !== "pending") return "already";
    await ctx.db.patch("sallaCodOrders", o._id, { addressAskedAt: Date.now() });
    return "asked";
  },
});

/** The pending order this number asked to change the address of (latest, within the window); first = no address yet. */
export const takeAddress = internalMutation({
  args: { fromHash: v.string() },
  handler: async (ctx, { fromHash }) => {
    const now = Date.now();
    const asked = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_phone_address", (q) => q.eq("phoneHash", fromHash).gte("addressAskedAt", now - ADDRESS_WINDOW_MS))
      .order("desc")
      .take(5);
    const o = asked.find((x) => x.status === "pending");
    if (!o) return null;
    const first = !o.addressAt || o.addressAt < (o.addressAskedAt ?? 0);
    await ctx.db.patch("sallaCodOrders", o._id, { addressAt: now });
    return { merchantId: o.merchantId, orderId: o.orderId, first };
  },
});

export const markFailed = internalMutation({
  args: { waMessageId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const o = await ctx.db.query("sallaCodOrders").withIndex("by_wa_message", (q) => q.eq("waMessageId", args.waMessageId)).first();
    if (o) await ctx.db.patch("sallaCodOrders", o._id, { lastError: args.error });
  },
});

type SallaOrder = {
  reference_id?: number | string;
  customer?: { first_name?: string; mobile?: number | string; mobile_code?: string };
  amounts?: { total?: { amount?: number | string; currency?: string } };
};

/** The confirm message (reminder 0) or a reminder; schedules the next step while the order stays pending. */
export const sendConfirm = internalAction({
  args: { merchantId: v.number(), orderId: v.string(), reminder: v.number() },
  handler: async (ctx, { merchantId, orderId, reminder }): Promise<void> => {
    const o = await ctx.runQuery(internal.sallaWhatsapp.order, { merchantId, orderId });
    if (!o || o.status !== "pending") return;
    const fail = async (e: unknown): Promise<void> => { await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId, orderId, lastError: errorText(e) }); };
    const s = sender();
    const key = process.env.SHOPIFY_TOKEN_KEY?.trim();
    if (!s || !key) return fail("WhatsApp isn't set up (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID), so the customer wasn't asked");
    try {
      const token = await accessToken(ctx, merchantId);
      const ord = await sallaFetch<SallaOrder>(token, `/orders/${orderId}`);
      const to = waNumber(ord?.customer?.mobile, ord?.customer?.mobile_code);
      if (!to) throw new Error("The order has no usable mobile number");
      const hash = await phoneHash(to, key);

      // Refused a confirmed order before: flag it, or cancel it when the merchant asked for that.
      if (reminder === 0) {
        const prior = await ctx.runQuery(internal.sallaWhatsapp.priorRefusals, { merchantId, phoneHash: hash });
        if (prior.refusals > 0) {
          const cancelled: boolean = await ctx.runMutation(internal.sallaWhatsapp.flagRefuser, {
            merchantId, orderId, phoneHash: hash, refusals: prior.refusals, cancel: prior.block,
          });
          if (cancelled) return;
        }
      }

      const store = await ctx.runQuery(internal.sallaOrders.store, { merchantId });
      let storeName = store?.storeName;
      if (!storeName) {
        storeName = (await sallaFetch<{ name?: string }>(token, "/store/info").catch(() => null))?.name?.trim() || undefined;
        if (storeName) await ctx.runMutation(internal.sallaWhatsapp.saveStoreName, { merchantId, name: storeName });
      }
      const total = ord?.amounts?.total;
      const template = {
        name: process.env.WHATSAPP_TEMPLATE?.trim() || CONFIRM_TEMPLATE.name,
        language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || CONFIRM_TEMPLATE.language,
      };
      const waMessageId = await waSend(s, confirmMessage(to, {
        customer: ord?.customer?.first_name?.trim() || "عميلنا العزيز",
        store: storeName ?? "المتجر",
        reference: String(ord?.reference_id ?? o.referenceId ?? orderId),
        total: total?.amount != null ? `${total.amount} ${total.currency ?? o.currency ?? ""}`.trim() : "-",
      }, merchantId, orderId, template));
      await ctx.runMutation(internal.sallaWhatsapp.recordSent, { merchantId, orderId, phoneHash: hash, waMessageId, reminder });
    } catch (e) {
      return fail(e); // no reminders after a failed send: the merchant sees the error and calls
    }
    if (reminder < REMINDER_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(REMINDER_DELAYS_MS[reminder], internal.sallaWhatsapp.sendConfirm, { merchantId, orderId, reminder: reminder + 1 });
    } else {
      await ctx.scheduler.runAfter(AUTO_CANCEL_AFTER_MS, internal.sallaWhatsapp.cancelUnanswered, { merchantId, orderId });
    }
  },
});

export const priorRefusals = internalQuery({
  args: { merchantId: v.number(), phoneHash: v.string() },
  handler: async (ctx, { merchantId, phoneHash: hash }) => {
    const r = await ctx.db
      .query("sallaRefusers")
      .withIndex("by_merchant_phone", (q) => q.eq("merchantId", merchantId).eq("phoneHash", hash))
      .unique();
    const store = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", merchantId)).unique();
    return { refusals: r?.refusals ?? 0, block: !!store?.blockRefusers };
  },
});

/** Notes the earlier refusals on the order; with `cancel`, cancels it without asking. True when cancelled. */
export const flagRefuser = internalMutation({
  args: { merchantId: v.number(), orderId: v.string(), phoneHash: v.string(), refusals: v.number(), cancel: v.boolean() },
  handler: async (ctx, { merchantId, orderId, phoneHash: hash, refusals, cancel }) => {
    const o = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", merchantId).eq("orderId", orderId))
      .unique();
    if (!o) return false;
    await ctx.db.patch("sallaCodOrders", o._id, { priorRefusals: refusals, phoneHash: hash });
    if (!cancel) return false;
    const r = await claim(ctx, {
      merchantId, orderId, answer: "cancelled",
      note: `أُلغي الطلب تلقائياً: سبق لهذا العميل رفض استلام ${refusals} من طلبات الدفع عند الاستلام بعد تأكيدها`,
    });
    // Not a customer answer: keep it out of the answer rate.
    if (r === "taken") await ctx.db.patch("sallaCodOrders", o._id, { answeredAt: undefined, blocked: true });
    return r === "taken";
  },
});

export const cancelUnanswered = internalMutation({
  args: { merchantId: v.number(), orderId: v.string() },
  handler: async (ctx, { merchantId, orderId }) => {
    await claim(ctx, { merchantId, orderId, answer: "cancelled", note: "أُلغي الطلب تلقائياً: لم يرد العميل على رسائل التأكيد عبر واتساب" });
  },
});

/** Meta's webhook check when the URL is saved in the app dashboard. */
export const verify = httpAction(async (_ctx, request) => {
  const q = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (expected && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
});

type Sender = ReturnType<typeof sender>;

/** A button on a Shopify order's message (Istilam for Shopify), same replies as Salla's. */
async function shopifyTap(ctx: ActionCtx, s: Sender, from: string, fromHash: string, tap: { shopKey: string; orderId: string; answer: Tap }) {
  const { shopKey, orderId } = tap;
  if (tap.answer === "address") {
    const r = await ctx.runMutation(internal.shopifyCodWhatsapp.askAddress, { shopKey, orderId, fromHash });
    if (r !== "ignored" && s) await waSend(s, r === "asked" ? locationRequest(from, REPLIES.askAddress) : textMessage(from, REPLIES.already)).catch(() => {});
    return;
  }
  const result: "taken" | "already" | "ignored" = await ctx.runMutation(internal.shopifyCodWhatsapp.claimAnswer, { shopKey, orderId, answer: tap.answer, fromHash });
  if (result !== "ignored" && s) await waSend(s, textMessage(from, result === "taken" ? REPLIES[tap.answer] : REPLIES.already)).catch(() => {});
}

export const webhook = httpAction(async (ctx, request) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const raw = await request.text();
  if (!appSecret || !(await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const key = process.env.SHOPIFY_TOKEN_KEY?.trim();
  const s = sender();
  for (const evt of parseWaWebhook(body)) {
    if (evt.kind === "failed") {
      await ctx.runMutation(internal.sallaWhatsapp.markFailed, { waMessageId: evt.messageId, error: evt.error });
      await ctx.runMutation(internal.shopifyCodWhatsapp.markFailed, { waMessageId: evt.messageId, error: evt.error });
      continue;
    }
    if (!key) continue;
    // Meta retries deliveries: act on each message once.
    const once = evt.kind === "button" ? evt.messageId || evt.payload : evt.messageId;
    if (!once || !(await ctx.runMutation(internal.sallaApp.markDelivery, { key: `wa:${once}` }))) continue;
    const fromHash = await phoneHash(evt.from, key);

    if (evt.kind === "text" || evt.kind === "location") {
      // Only a number that tapped "تعديل العنوان" is answered; other messages are left for the store.
      const note = addressNote(evt.kind === "text" ? { text: evt.text } : evt);
      const hit = await ctx.runMutation(internal.sallaWhatsapp.takeAddress, { fromHash });
      if (!hit) {
        const shp = await ctx.runMutation(internal.shopifyCodWhatsapp.takeAddress, { fromHash });
        if (!shp) continue;
        await ctx.scheduler.runAfter(0, internal.shopifyCodOrders.appendNote, { shopKey: shp.shopKey, orderId: shp.orderId, line: note });
        if (shp.first && s) {
          const payloadFor = (t: Tap) => shopifyButtonPayload(shp.shopKey, shp.orderId, t);
          await waSend(s, answerButtonsWith(evt.from, REPLIES.addressSaved, payloadFor)).catch(() => {});
        }
        continue;
      }
      try {
        const token = await accessToken(ctx, hit.merchantId);
        await sallaFetch(token, `/orders/${hit.orderId}/histories`, { method: "POST", body: { note } });
      } catch (e) {
        await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId: hit.merchantId, orderId: hit.orderId, lastError: errorText(e) });
      }
      if (hit.first && s) await waSend(s, answerButtons(evt.from, REPLIES.addressSaved, hit.merchantId, hit.orderId)).catch(() => {});
      continue;
    }

    const any = parseAnyPayload(evt.payload);
    if (!any) continue;
    if (any.platform === "shopify") {
      await shopifyTap(ctx, s, evt.from, fromHash, any);
      continue;
    }
    const tap = any;
    // The tap opened the 24 h service window, so free-form replies are allowed.
    if (tap.answer === "address") {
      const r = await ctx.runMutation(internal.sallaWhatsapp.askAddress, { merchantId: tap.merchantId, orderId: tap.orderId, fromHash });
      if (r !== "ignored" && s) await waSend(s, r === "asked" ? locationRequest(evt.from, REPLIES.askAddress) : textMessage(evt.from, REPLIES.already)).catch(() => {});
      continue;
    }
    const result: "taken" | "already" | "ignored" = await ctx.runMutation(internal.sallaWhatsapp.claimAnswer, {
      merchantId: tap.merchantId, orderId: tap.orderId, answer: tap.answer, fromHash,
    });
    if (result !== "ignored" && s) {
      await waSend(s, textMessage(evt.from, result === "taken" ? REPLIES[tap.answer] : REPLIES.already)).catch(() => {});
    }
  }
  return new Response(null, { status: 200 });
});
