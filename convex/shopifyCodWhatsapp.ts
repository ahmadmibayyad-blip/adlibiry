import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { errorText } from "./sallaOrders";
import { releasedInShopify } from "./shopifyCodOrders";
import { sender, waSend } from "./sallaWhatsapp";
import { gql } from "./shopifyCodAuth";
import { pickPhone, type ShopifyPhoneOrder } from "./lib/shopifyCod";
import {
  ADDRESS_WINDOW_MS, AUTO_CANCEL_AFTER_MS, CONFIRM_TEMPLATE, REMINDER_DELAYS_MS, confirmMessageWith, phoneHash, shopifyButtonPayload,
} from "./lib/whatsapp";

// Istilam for Shopify, the WhatsApp half: the Shopify twin of sallaWhatsapp.ts, keyed by
// {shopKey, orderId}. After hold() (shopifyCodOrders.ts) the customer gets the confirm template
// (same Meta number, templates and timings as Salla), reminders at +2 h and +24 h, and the order
// is cancelled a day after the last one with no answer. Taps and addresses arrive on the shared
// /whatsapp/webhook (sallaWhatsapp.ts), which sends `shp:` payloads here. The customer's number
// is read from Shopify when sending and never stored.

type Ans = "confirmed" | "cancelled";
const answer = v.union(v.literal("confirmed"), v.literal("cancelled"));
const keyArgs = { shopKey: v.string(), orderId: v.string() };

async function orderRow(ctx: MutationCtx, shopKey: string, orderId: string) {
  return ctx.db.query("shopifyCodOrders").withIndex("by_shop_order", (q) => q.eq("shopKey", shopKey).eq("orderId", orderId)).unique();
}

export const saveShopName = internalMutation({
  args: { shopKey: v.string(), name: v.string() },
  handler: async (ctx, { shopKey, name }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (s) await ctx.db.patch("shopifyCodShops", s._id, { name });
  },
});

export const recordSent = internalMutation({
  args: { ...keyArgs, phoneHash: v.string(), waMessageId: v.string(), reminder: v.number() },
  handler: async (ctx, { shopKey, orderId, reminder, ...fields }) => {
    const o = await orderRow(ctx, shopKey, orderId);
    if (o) await ctx.db.patch("shopifyCodOrders", o._id, { ...fields, reminders: reminder, sentAt: Date.now(), lastError: undefined });
  },
});

type ClaimArgs = { shopKey: string; orderId: string; answer: Ans; fromHash?: string; note?: string };

/** Takes the answer once, only from the number the message went to (`fromHash`; omitted for the no-answer cancel). */
async function claim(ctx: MutationCtx, { shopKey, orderId, answer, fromHash, note }: ClaimArgs): Promise<"taken" | "already" | "ignored"> {
  const o = await orderRow(ctx, shopKey, orderId);
  if (!o || (fromHash !== undefined && o.phoneHash !== fromHash)) return "ignored";
  if (o.status !== "pending") return "already";
  await ctx.db.patch("shopifyCodOrders", o._id, { status: answer, answeredAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.shopifyCodOrders.decide, { shopKey, orderId, decision: answer, note });
  return "taken";
}

export const claimAnswer = internalMutation({
  args: { ...keyArgs, answer, fromHash: v.string() },
  handler: (ctx, args) => claim(ctx, args),
});

export const askAddress = internalMutation({
  args: { ...keyArgs, fromHash: v.string() },
  handler: async (ctx, { shopKey, orderId, fromHash }): Promise<"asked" | "already" | "ignored"> => {
    const o = await orderRow(ctx, shopKey, orderId);
    if (!o || o.phoneHash !== fromHash) return "ignored";
    if (o.status !== "pending") return "already";
    await ctx.db.patch("shopifyCodOrders", o._id, { addressAskedAt: Date.now() });
    return "asked";
  },
});

/** The pending order this number asked to change the address of (latest, within the window); first = no address yet. */
export const takeAddress = internalMutation({
  args: { fromHash: v.string() },
  handler: async (ctx, { fromHash }) => {
    const now = Date.now();
    const asked = await ctx.db
      .query("shopifyCodOrders")
      .withIndex("by_phone_address", (q) => q.eq("phoneHash", fromHash).gte("addressAskedAt", now - ADDRESS_WINDOW_MS))
      .order("desc")
      .take(5);
    const o = asked.find((x) => x.status === "pending");
    if (!o) return null;
    const first = !o.addressAt || o.addressAt < (o.addressAskedAt ?? 0);
    await ctx.db.patch("shopifyCodOrders", o._id, { addressAt: now });
    return { shopKey: o.shopKey, orderId: o.orderId, first };
  },
});

export const markFailed = internalMutation({
  args: { waMessageId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const o = await ctx.db.query("shopifyCodOrders").withIndex("by_wa_message", (q) => q.eq("waMessageId", args.waMessageId)).first();
    if (o) await ctx.db.patch("shopifyCodOrders", o._id, { lastError: args.error });
  },
});

export const priorRefusals = internalQuery({
  args: { shopKey: v.string(), phoneHash: v.string() },
  handler: async (ctx, { shopKey, phoneHash: hash }) => {
    const r = await ctx.db.query("shopifyCodRefusers").withIndex("by_shop_phone", (q) => q.eq("shopKey", shopKey).eq("phoneHash", hash)).unique();
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    return { refusals: r?.refusals ?? 0, block: !!s?.blockRefusers };
  },
});

/** Notes the earlier refusals on the order; with `cancel`, cancels it without asking. True when cancelled. */
export const flagRefuser = internalMutation({
  args: { ...keyArgs, phoneHash: v.string(), refusals: v.number(), cancel: v.boolean() },
  handler: async (ctx, { shopKey, orderId, phoneHash: hash, refusals, cancel }) => {
    const o = await orderRow(ctx, shopKey, orderId);
    if (!o) return false;
    await ctx.db.patch("shopifyCodOrders", o._id, { priorRefusals: refusals, phoneHash: hash });
    if (!cancel) return false;
    const r = await claim(ctx, {
      shopKey, orderId, answer: "cancelled",
      note: `Istilam: cancelled automatically, this customer refused ${refusals} confirmed COD order(s) before`,
    });
    if (r === "taken") await ctx.db.patch("shopifyCodOrders", o._id, { answeredAt: undefined, blocked: true });
    return r === "taken";
  },
});

export const cancelUnanswered = internalMutation({
  args: keyArgs,
  handler: async (ctx, { shopKey, orderId }) => {
    await claim(ctx, { shopKey, orderId, answer: "cancelled", note: "Istilam: cancelled automatically, the customer didn't answer the WhatsApp confirmation" });
  },
});

type MessageOrder = ShopifyPhoneOrder & {
  name?: string;
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  shippingAddress?: (ShopifyPhoneOrder["shippingAddress"] & { firstName?: string | null }) | null;
  customer?: (ShopifyPhoneOrder["customer"] & { firstName?: string | null }) | null;
};

/** The confirm message (reminder 0) or a reminder; schedules the next step while the order stays pending. */
export const sendConfirm = internalAction({
  args: { ...keyArgs, reminder: v.number() },
  handler: async (ctx, { shopKey, orderId, reminder }): Promise<void> => {
    const o = await ctx.runQuery(internal.shopifyCodOrders.order, { shopKey, orderId });
    if (!o || o.status !== "pending") return;
    const fail = async (e: unknown): Promise<void> => { await ctx.runMutation(internal.shopifyCodOrders.recordOrder, { shopKey, orderId, lastError: errorText(e) }); };
    const s = sender();
    const key = process.env.SHOPIFY_TOKEN_KEY?.trim();
    if (!s || !key) return fail("WhatsApp isn't set up (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID), so the customer wasn't asked");
    // A reminder for an order the merchant already released in Shopify admin: stop here.
    if (reminder > 0 && (await releasedInShopify(ctx, shopKey, orderId, o.heldAt).catch(() => false))) {
      await ctx.runMutation(internal.shopifyCodOrders.closeReleased, { shopKey, orderId });
      return;
    }
    try {
      const r = await gql<{ order?: MessageOrder | null; shop?: { name?: string } }>(ctx, shopKey,
        `query IstilamOrderForMessage($id: ID!) { order(id: $id) { name totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { firstName phone countryCodeV2 } billingAddress { phone countryCodeV2 }
          customer { firstName defaultPhoneNumber { phoneNumber } } } shop { name } }`,
        { id: `gid://shopify/Order/${orderId}` });
      const ord = r.order ?? {};
      const to = pickPhone(ord);
      if (!to) {
        await ctx.scheduler.runAfter(0, internal.shopifyCodOrders.releaseHold, { shopKey, orderId });
        throw new Error("The order has no usable mobile number");
      }
      const hash = await phoneHash(to, key);

      if (reminder === 0) {
        const prior = await ctx.runQuery(internal.shopifyCodWhatsapp.priorRefusals, { shopKey, phoneHash: hash });
        if (prior.refusals > 0) {
          const cancelled: boolean = await ctx.runMutation(internal.shopifyCodWhatsapp.flagRefuser, {
            shopKey, orderId, phoneHash: hash, refusals: prior.refusals, cancel: prior.block,
          });
          if (cancelled) return;
        }
      }

      const shopName = r.shop?.name?.trim();
      if (shopName) await ctx.runMutation(internal.shopifyCodWhatsapp.saveShopName, { shopKey, name: shopName });
      const money = ord.totalPriceSet?.shopMoney;
      const template = {
        name: process.env.WHATSAPP_TEMPLATE?.trim() || CONFIRM_TEMPLATE.name,
        language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || CONFIRM_TEMPLATE.language,
      };
      const waMessageId = await waSend(s, confirmMessageWith(to, {
        customer: ord.shippingAddress?.firstName?.trim() || ord.customer?.firstName?.trim() || "عميلنا العزيز",
        store: shopName || "المتجر",
        reference: ord.name ?? o.orderName ?? orderId,
        total: money?.amount ? `${money.amount} ${money.currencyCode ?? o.currency ?? ""}`.trim() : "-",
      }, (t) => shopifyButtonPayload(shopKey, orderId, t), template));
      await ctx.runMutation(internal.shopifyCodWhatsapp.recordSent, { shopKey, orderId, phoneHash: hash, waMessageId, reminder });
    } catch (e) {
      return fail(e);
    }
    if (reminder < REMINDER_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(REMINDER_DELAYS_MS[reminder], internal.shopifyCodWhatsapp.sendConfirm, { shopKey, orderId, reminder: reminder + 1 });
    } else {
      await ctx.scheduler.runAfter(AUTO_CANCEL_AFTER_MS, internal.shopifyCodWhatsapp.cancelUnanswered, { shopKey, orderId });
    }
  },
});
