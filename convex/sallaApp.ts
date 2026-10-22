import { v } from "convex/values";
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { encryptToken } from "./lib/shopifyOAuth";
import { codOrderFrom, parseAuthorize, parseSallaEvent, signBody, verifySallaSignature } from "./lib/sallaWebhook";

// AdSpy COD Confirm, the Salla app (Partner app 1730909299, Easy Mode OAuth).
// Salla posts every event to https://<deployment>.convex.site/salla/webhook:
// app.store.authorize carries the store's tokens (install and every refresh),
// order.created starts a COD confirmation. Convex env: SALLA_WEBHOOK_SECRET (the
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
    await ctx.db.insert("sallaCodOrders", { ...args, status: "pending", createdAt: Date.now() });
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
  }
  return new Response(null, { status: 200 });
});
