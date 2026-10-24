import { v } from "convex/values";
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { encryptToken } from "./lib/shopifyOAuth";
import { REFUSAL_SLUGS, codOrderFrom, parseAuthorize, parseSallaEvent, signBody, statusUpdateFrom, verifySallaSignature } from "./lib/sallaWebhook";
import { planEventFrom, planGate, usageMonth, type StoredPlan, type Tier } from "./lib/sallaPlans";

// Istilam (AdSpy COD Confirm), the Salla app (Partner app 1730909299, Easy Mode OAuth).
// Salla posts every event to https://<deployment>.convex.site/salla/webhook:
// app.store.authorize carries the store's tokens (install and every refresh),
// order.created starts a COD confirmation, order.status.updated catches confirmed orders
// that came back (refused at the door), app.subscription.* / app.trial.* set the store's
// plan and its monthly confirmations (lib/sallaPlans.ts). Convex env: SALLA_WEBHOOK_SECRET (the
// app's webhook secret from the Partner Portal; SALLA_WEBHOOK_SECRET_PREVIOUS
// while a rotated one awaits approval) and SHOPIFY_TOKEN_KEY, the AES key that
// also encrypts the Shopify tokens.

/** Records the delivery; false when it was seen before (Salla retries and may send twice). */
export const markDelivery = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const seen = await ctx.db.query("sallaWebhookEvents").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (seen) return false;
    await ctx.db.insert("sallaWebhookEvents", { key: args.key, receivedAt: Date.now() });
    return true;
  },
});

/** Upserts the store's tokens: Salla's refresh tokens are single use, so the newest pair always wins. */
export const saveTokens = internalMutation({
  args: { merchantId: v.number(), accessToken: v.string(), refreshToken: v.string(), expiresAt: v.number(), scope: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    const row = { ...args, updatedAt: Date.now(), uninstalledAt: undefined };
    if (existing) await ctx.db.patch("sallaStores", existing._id, row);
    else await ctx.db.insert("sallaStores", { ...row, installedAt: Date.now() });
  },
});

/** app.uninstalled: drop the tokens at once; the store's COD orders go with them. */
export const forgetStore = internalMutation({
  args: { merchantId: v.number() },
  handler: async (ctx, args) => {
    for (const s of await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).collect()) {
      await ctx.db.delete("sallaStores", s._id);
    }
    const orders = await ctx.db.query("sallaCodOrders").withIndex("by_merchant_order", (q) => q.eq("merchantId", args.merchantId)).take(500);
    for (const o of orders) await ctx.db.delete("sallaCodOrders", o._id);
    const refusers = await ctx.db.query("sallaRefusers").withIndex("by_merchant_phone", (q) => q.eq("merchantId", args.merchantId)).take(500);
    for (const r of refusers) await ctx.db.delete("sallaRefusers", r._id);
  },
});

export const addCodOrder = internalMutation({
  args: {
    merchantId: v.number(),
    orderId: v.string(),
    referenceId: v.optional(v.string()),
    total: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", args.merchantId).eq("orderId", args.orderId))
      .unique();
    if (existing) return;
    // The merchant turned confirmations off in the dashboard: leave the order alone.
    const store = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    if (store?.paused) return;
    // The plan's monthly allowance: over it (or with no active plan) the order is left alone and counted.
    const now = Date.now();
    const plan = await ctx.db.query("sallaPlans").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    const gate = planGate(plan as StoredPlan | null, now);
    const month = usageMonth(now);
    const usage = await ctx.db
      .query("sallaUsage")
      .withIndex("by_merchant_month", (q) => q.eq("merchantId", args.merchantId).eq("month", month))
      .unique();
    const sent = usage?.sent ?? 0;
    const allowed = !gate.limited || (gate.active && (gate.limit == null || sent < gate.limit));
    const next = { sent: sent + (allowed ? 1 : 0), skipped: (usage?.skipped ?? 0) + (allowed ? 0 : 1) };
    if (usage) await ctx.db.patch("sallaUsage", usage._id, next);
    else await ctx.db.insert("sallaUsage", { merchantId: args.merchantId, month, ...next });
    if (!allowed) return;
    await ctx.db.insert("sallaCodOrders", { ...args, status: "pending", createdAt: Date.now() });
    // Set "بانتظار التأكيد" in Salla after the webhook has answered (Salla waits ~30 s at most).
    await ctx.scheduler.runAfter(0, internal.sallaOrders.hold, { merchantId: args.merchantId, orderId: args.orderId });
  },
});

/**
 * A confirmed order went to returned/cancelled in Salla: the customer refused it at the door.
 * Counted once per order against the number it was confirmed from (hash only).
 */
export const recordRefusal = internalMutation({
  args: { merchantId: v.number(), orderId: v.string() },
  handler: async (ctx, args) => {
    const o = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", args.merchantId).eq("orderId", args.orderId))
      .unique();
    if (!o || o.status !== "confirmed" || o.refusedAt || !o.phoneHash) return;
    const now = Date.now();
    await ctx.db.patch("sallaCodOrders", o._id, { refusedAt: now });
    const r = await ctx.db
      .query("sallaRefusers")
      .withIndex("by_merchant_phone", (q) => q.eq("merchantId", args.merchantId).eq("phoneHash", o.phoneHash!))
      .unique();
    if (r) await ctx.db.patch("sallaRefusers", r._id, { refusals: r.refusals + 1, lastAt: now });
    else await ctx.db.insert("sallaRefusers", { merchantId: args.merchantId, phoneHash: o.phoneHash, refusals: 1, lastAt: now });
  },
});

/**
 * app.subscription.* / app.trial.*: started and renewed set the plan; expired and canceled end it,
 * but only for the subscription on record (a trial ending after the paid plan began changes nothing).
 */
export const savePlan = internalMutation({
  args: {
    merchantId: v.number(),
    kind: v.union(v.literal("start"), v.literal("end")),
    trial: v.boolean(),
    subscriptionId: v.optional(v.string()),
    tier: v.string(),
    planName: v.optional(v.string()),
    endsAt: v.optional(v.number()),
    storeType: v.string(),
  },
  handler: async (ctx, { merchantId, kind, trial, ...p }) => {
    const existing = await ctx.db.query("sallaPlans").withIndex("by_merchant", (q) => q.eq("merchantId", merchantId)).unique();
    if (kind === "start") {
      const row = { merchantId, ...p, tier: p.tier as Tier, status: trial ? "trial" : "active", updatedAt: Date.now() };
      if (existing) await ctx.db.replace("sallaPlans", existing._id, row);
      else await ctx.db.insert("sallaPlans", row);
      return;
    }
    if (!existing || existing.status === "inactive") return;
    if (trial !== (existing.status === "trial")) return;
    if (p.subscriptionId && existing.subscriptionId && p.subscriptionId !== existing.subscriptionId) return;
    await ctx.db.patch("sallaPlans", existing._id, { status: "inactive", updatedAt: Date.now() });
  },
});

export const webhook = httpAction(async (ctx, request) => {
  const secrets = [process.env.SALLA_WEBHOOK_SECRET, process.env.SALLA_WEBHOOK_SECRET_PREVIOUS]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  const raw = await request.text();
  if (!secrets.length || !(await verifySallaSignature(raw, request.headers.get("x-salla-signature"), secrets))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const evt = parseSallaEvent(raw);
  if (!evt) return new Response("Bad payload", { status: 400 });

  // Dedupe on a hash of the exact bytes Salla sent (a retry resends the same body).
  const digest = (await signBody(raw, "dedupe")).slice(0, 32);
  if (!(await ctx.runMutation(internal.sallaApp.markDelivery, { key: `${evt.merchant}:${evt.event}:${digest}` }))) {
    return new Response(null, { status: 200 });
  }

  if (evt.event === "app.store.authorize") {
    const tokens = parseAuthorize(evt.data);
    const tokenKey = process.env.SHOPIFY_TOKEN_KEY?.trim();
    if (!tokens) return new Response("Bad authorize payload", { status: 400 });
    // Without the key the tokens can't be stored safely; a 500 makes Salla retry once it's set.
    if (!tokenKey) return new Response("Not configured", { status: 500 });
    await ctx.runMutation(internal.sallaApp.saveTokens, {
      merchantId: evt.merchant,
      accessToken: await encryptToken(tokens.accessToken, tokenKey),
      refreshToken: await encryptToken(tokens.refreshToken, tokenKey),
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
  } else if (evt.event === "app.uninstalled") {
    await ctx.runMutation(internal.sallaApp.forgetStore, { merchantId: evt.merchant });
  } else if (evt.event === "order.created") {
    const order = codOrderFrom(evt.data);
    if (order) await ctx.runMutation(internal.sallaApp.addCodOrder, { merchantId: evt.merchant, ...order });
  } else if (evt.event === "order.status.updated") {
    const upd = statusUpdateFrom(evt.data);
    if (upd && REFUSAL_SLUGS.includes(upd.slug)) {
      await ctx.runMutation(internal.sallaApp.recordRefusal, { merchantId: evt.merchant, orderId: upd.orderId });
    }
  } else {
    const plan = planEventFrom(evt.event, evt.data);
    if (plan) await ctx.runMutation(internal.sallaApp.savePlan, { merchantId: evt.merchant, ...plan });
  }
  return new Response(null, { status: 200 });
});
