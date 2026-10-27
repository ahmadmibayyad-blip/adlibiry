import { v } from "convex/values";
import { httpAction, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyWebhookHmac } from "./lib/shopifyOAuth";
import { usageMonth, type Tier } from "./lib/codPlans";
import { codOrderFromWebhook, shopGate, tierForPlanName } from "./lib/shopifyCod";

// Istilam for Shopify: Shopify posts the topics in shopify-istilam/shopify.app.toml to
// https://<deployment>.convex.site/shopify-istilam/webhook, signed with the app's client secret
// (X-Shopify-Hmac-Sha256). orders/create starts a COD confirmation (convex/shopifyCodOrders.ts
// holds it, shopifyCodWhatsapp.ts asks the customer); orders/cancelled and refunds/create close
// pending orders or catch confirmed ones that came back; app_subscriptions/update sets the plan;
// app/uninstalled and the compliance topics delete the shop's data.

const BATCH = 500;

async function shopRow(ctx: MutationCtx, shop: string) {
  return ctx.db.query("shopifyCodShops").withIndex("by_shop", (q) => q.eq("shop", shop)).unique();
}

async function orderRow(ctx: MutationCtx, shopKey: string, orderId: string) {
  return ctx.db.query("shopifyCodOrders").withIndex("by_shop_order", (q) => q.eq("shopKey", shopKey).eq("orderId", orderId)).unique();
}

const cancelKey = (shopKey: string, orderId: string) => `shp-cancelled:${shopKey}:${orderId}`;

async function bumpUsage(ctx: MutationCtx, shopKey: string, field: "sent" | "skipped") {
  const month = usageMonth(Date.now());
  const u = await ctx.db.query("shopifyCodUsage").withIndex("by_shop_month", (q) => q.eq("shopKey", shopKey).eq("month", month)).unique();
  if (u) await ctx.db.patch("shopifyCodUsage", u._id, { [field]: u[field] + 1 });
  else await ctx.db.insert("shopifyCodUsage", { shopKey, month, sent: field === "sent" ? 1 : 0, skipped: field === "skipped" ? 1 : 0 });
  return u?.sent ?? 0;
}

export const addOrder = internalMutation({
  args: { shop: v.string(), orderId: v.string(), orderName: v.string(), total: v.optional(v.number()), currency: v.optional(v.string()) },
  handler: async (ctx, { shop, ...order }): Promise<"held" | "skipped" | "duplicate" | "ignored"> => {
    const s = await shopRow(ctx, shop);
    if (!s || s.uninstalledAt) return "ignored";
    if (await orderRow(ctx, s.shopKey, order.orderId)) return "duplicate";
    const cancelled = await ctx.db.query("sallaWebhookEvents").withIndex("by_key", (q) => q.eq("key", cancelKey(s.shopKey, order.orderId))).unique();
    if (cancelled) return "ignored";

    const gate = shopGate(s.plan ? { ...s.plan, tier: s.plan.tier as Tier } : undefined, Date.now());
    const month = usageMonth(Date.now());
    const used = (await ctx.db.query("shopifyCodUsage").withIndex("by_shop_month", (q) => q.eq("shopKey", s.shopKey).eq("month", month)).unique())?.sent ?? 0;
    if (!s.enabled || !gate.active || (gate.limit != null && used >= gate.limit)) {
      await bumpUsage(ctx, s.shopKey, "skipped");
      return "skipped";
    }
    await ctx.db.insert("shopifyCodOrders", { shopKey: s.shopKey, ...order, status: "pending", createdAt: Date.now() });
    await bumpUsage(ctx, s.shopKey, "sent");
    await ctx.scheduler.runAfter(0, internal.shopifyCodOrders.hold, { shopKey: s.shopKey, orderId: order.orderId });
    return "held";
  },
});

async function refusal(ctx: MutationCtx, shopKey: string, o: { _id: import("./_generated/dataModel").Id<"shopifyCodOrders">; status: string; phoneHash?: string; refusedAt?: number }) {
  if (o.status !== "confirmed" || o.refusedAt) return;
  const now = Date.now();
  await ctx.db.patch("shopifyCodOrders", o._id, { refusedAt: now });
  if (!o.phoneHash) return;
  const hash = o.phoneHash;
  const r = await ctx.db.query("shopifyCodRefusers").withIndex("by_shop_phone", (q) => q.eq("shopKey", shopKey).eq("phoneHash", hash)).unique();
  if (r) await ctx.db.patch("shopifyCodRefusers", r._id, { refusals: r.refusals + 1, lastAt: now });
  else await ctx.db.insert("shopifyCodRefusers", { shopKey, phoneHash: hash, refusals: 1, lastAt: now });
}

/** Cancelled in Shopify: a pending order stops (no more reminders); a confirmed one was refused. */
export const orderCancelled = internalMutation({
  args: { shop: v.string(), orderId: v.string() },
  handler: async (ctx, { shop, orderId }) => {
    const s = await shopRow(ctx, shop);
    if (!s) return;
    const o = await orderRow(ctx, s.shopKey, orderId);
    if (!o) {
      // Cancelled before our orders/create was handled: don't start a confirmation for it.
      await ctx.db.insert("sallaWebhookEvents", { key: cancelKey(s.shopKey, orderId), receivedAt: Date.now() });
    } else if (o.status === "pending") {
      await ctx.db.patch("shopifyCodOrders", o._id, { status: "cancelled", decidedAt: Date.now() });
    } else {
      await refusal(ctx, s.shopKey, o);
    }
  },
});

export const recordRefusal = internalMutation({
  args: { shop: v.string(), orderId: v.string() },
  handler: async (ctx, { shop, orderId }) => {
    const s = await shopRow(ctx, shop);
    const o = s && (await orderRow(ctx, s.shopKey, orderId));
    if (s && o) await refusal(ctx, s.shopKey, o);
  },
});

/** Deletes the shop's orders, refusers and usage in batches; with `dropShop` also the shop row (shop/redact). */
export const purgeShop = internalMutation({
  args: { shopKey: v.string(), dropShop: v.boolean() },
  handler: async (ctx, { shopKey, dropShop }) => {
    const orders = await ctx.db.query("shopifyCodOrders").withIndex("by_shop_created", (q) => q.eq("shopKey", shopKey)).take(BATCH);
    for (const r of orders) await ctx.db.delete("shopifyCodOrders", r._id);
    const refusers = await ctx.db.query("shopifyCodRefusers").withIndex("by_shop_phone", (q) => q.eq("shopKey", shopKey)).take(BATCH);
    for (const r of refusers) await ctx.db.delete("shopifyCodRefusers", r._id);
    const usage = await ctx.db.query("shopifyCodUsage").withIndex("by_shop_month", (q) => q.eq("shopKey", shopKey)).take(BATCH);
    for (const r of usage) await ctx.db.delete("shopifyCodUsage", r._id);
    if (orders.length + refusers.length + usage.length > 0) {
      await ctx.scheduler.runAfter(0, internal.shopifyCodApp.purgeShop, { shopKey, dropShop });
      return;
    }
    if (dropShop) {
      const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
      if (s) await ctx.db.delete("shopifyCodShops", s._id);
    }
  },
});

export const forgetShop = internalMutation({
  args: { shop: v.string(), dropShop: v.boolean() },
  handler: async (ctx, { shop, dropShop }) => {
    const s = await shopRow(ctx, shop);
    if (!s) return;
    await ctx.db.patch("shopifyCodShops", s._id, {
      tokenEnc: undefined, refreshTokenEnc: undefined, tokenExpiresAt: undefined, refreshLockUntil: undefined,
      plan: undefined, feedKey: undefined, uninstalledAt: s.uninstalledAt ?? Date.now(), updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.shopifyCodApp.purgeShop, { shopKey: s.shopKey, dropShop });
  },
});

/** customers/redact: that customer's order rows, and their number's hash in the refusers list. */
export const redactCustomer = internalMutation({
  args: { shop: v.string(), orderIds: v.array(v.string()) },
  handler: async (ctx, { shop, orderIds }) => {
    const s = await shopRow(ctx, shop);
    if (!s) return;
    for (const id of orderIds) {
      const o = await orderRow(ctx, s.shopKey, id);
      if (!o) continue;
      const hash = o.phoneHash;
      if (hash) {
        const r = await ctx.db.query("shopifyCodRefusers").withIndex("by_shop_phone", (q) => q.eq("shopKey", s.shopKey).eq("phoneHash", hash)).unique();
        if (r) await ctx.db.delete("shopifyCodRefusers", r._id);
      }
      await ctx.db.delete("shopifyCodOrders", o._id);
    }
  },
});

/** The shop's plan from a subscription (webhook or currentAppInstallation); null clears it. */
export const savePlan = internalMutation({
  args: {
    shop: v.string(),
    subscription: v.union(v.null(), v.object({
      id: v.string(), name: v.string(), status: v.string(), test: v.optional(v.boolean()),
      currentPeriodEnd: v.optional(v.number()), trialEndsAt: v.optional(v.number()),
    })),
    checkedAt: v.optional(v.number()),
  },
  handler: async (ctx, { shop, subscription: sub, checkedAt }) => {
    const s = await shopRow(ctx, shop);
    if (!s) return;
    const tier = sub && tierForPlanName(sub.name);
    const plan = sub && tier ? {
      tier, status: sub.status, subscriptionId: sub.id, name: sub.name, test: sub.test ?? s.plan?.test ?? false,
      currentPeriodEnd: sub.currentPeriodEnd ?? (s.plan?.subscriptionId === sub.id ? s.plan.currentPeriodEnd : undefined),
      trialEndsAt: sub.trialEndsAt ?? (s.plan?.subscriptionId === sub.id ? s.plan.trialEndsAt : undefined),
      checkedAt,
    } : undefined;
    await ctx.db.patch("shopifyCodShops", s._id, { plan, updatedAt: Date.now() });
  },
});

const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((i) => typeof i === "number" || typeof i === "string").map(String) : []);

export const webhook = httpAction(async (ctx, request) => {
  const secret = process.env.SHOPIFY_ISTILAM_CLIENT_SECRET?.trim();
  const raw = await request.text();
  if (!secret || !(await verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "";
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  // Shopify retries: handle each delivery once.
  if (webhookId && !(await ctx.runMutation(internal.sallaApp.markDelivery, { key: `shp:${webhookId}` }))) {
    return new Response(null, { status: 200 });
  }

  switch (topic) {
    case "orders/create": {
      const order = codOrderFromWebhook(body);
      if (order && !body.cancelled_at) await ctx.runMutation(internal.shopifyCodApp.addOrder, { shop, ...order });
      break;
    }
    case "orders/cancelled":
      if (body.id != null) await ctx.runMutation(internal.shopifyCodApp.orderCancelled, { shop, orderId: String(body.id) });
      break;
    case "refunds/create":
      if (body.order_id != null) await ctx.runMutation(internal.shopifyCodApp.recordRefusal, { shop, orderId: String(body.order_id) });
      break;
    case "app_subscriptions/update": {
      const sub = body.app_subscription as { admin_graphql_api_id?: unknown; name?: unknown; status?: unknown } | undefined;
      if (typeof sub?.admin_graphql_api_id === "string" && typeof sub.name === "string" && typeof sub.status === "string") {
        await ctx.runMutation(internal.shopifyCodApp.savePlan, {
          shop, subscription: { id: sub.admin_graphql_api_id, name: sub.name, status: sub.status.toUpperCase() },
        });
      }
      break;
    }
    case "app/uninstalled":
      await ctx.runMutation(internal.shopifyCodApp.forgetShop, { shop, dropShop: false });
      break;
    case "shop/redact":
      await ctx.runMutation(internal.shopifyCodApp.forgetShop, { shop, dropShop: true });
      break;
    case "customers/redact":
      await ctx.runMutation(internal.shopifyCodApp.redactCustomer, { shop, orderIds: ids(body.orders_to_redact) });
      break;
    case "customers/data_request":
      // We hold no customer data beyond a keyed phone hash; the merchant answers the customer.
      console.log(`Istilam data request for ${shop}, request ${String((body.data_request as { id?: unknown } | undefined)?.id ?? "?")}`);
      break;
  }
  return new Response(null, { status: 200 });
});
