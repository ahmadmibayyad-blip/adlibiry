import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { decryptToken } from "./lib/shopifyOAuth";
import { orderGql, ShopifyError } from "./lib/shopifyOrderApi";
import { cjShippingOptions } from "./lib/cj";
import {
  FULFILLMENT_CREATE,
  FULFILLMENT_ORDERS_QUERY,
  OPEN_ORDERS_QUERY,
  cjOrderBody,
  cjOrderMade,
  cjTracking,
  fulfillmentInput,
  openOrders,
  openOrdersSearch,
  type LinkedItem,
  type ShipTo,
} from "./lib/cjOrders";
import { accessToken, cj, pause } from "./cj";

// Order autopilot with CJ (lib/cjOrders.ts), off until the user turns it on (/dashboard/orders):
// every 30 minutes paid, unfulfilled Shopify orders come in; items linked to a CJ variant (cjLinks) get a shipping
// quote, and the order waits for the user's Approve. Approve creates the CJ order: unpaid by default (pay it in CJ),
// or paid from the CJ balance when the user chose that. Hourly, CJ's tracking numbers go to Shopify, which emails
// the customer. The address is deleted once the order is at CJ (or rejected).

export const ORDER_SCOPES = ["read_orders", "write_merchant_managed_fulfillment_orders"];
const LOOK_BACK_DAYS = 14;
const hasScopes = (granted: string | undefined, need: string[]) => {
  if (granted === undefined) return true;
  const have = new Set(granted.split(",").map((s) => s.trim()));
  return need.every((s) => have.has(s));
};

async function me(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function settingsOf(ctx: QueryCtx, userId: Id<"users">) {
  const s = await ctx.db.query("orderSettings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  return { autopilot: s?.autopilot ?? false, payFromBalance: s?.payFromBalance ?? false };
}

/** What the page shows: no full addresses, only where it goes. */
const shown = (o: Doc<"cjOrders">) => ({
  _id: o._id,
  orderName: o.orderName,
  createdAt: o.createdAt,
  status: o.status,
  shipToLabel: o.shipToLabel,
  items: o.items,
  shipping: o.shipping,
  cjOrderId: o.cjOrderId,
  cjCostUsd: o.cjCostUsd,
  tracking: o.tracking,
  error: o.error,
  updatedAt: o.updatedAt,
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await me(ctx);
    if (!user) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const rows = await ctx.db.query("cjOrders").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(60);
    const links = await ctx.db.query("cjLinks").withIndex("by_user_variant", (q) => q.eq("userId", user._id)).take(200);
    return {
      store: store ? { shopName: store.shopName, canUse: hasScopes(store.scopes, ORDER_SCOPES) } : null,
      cjReady: !!process.env.CJ_API_KEY?.trim(),
      settings: await settingsOf(ctx, user._id),
      orders: rows.map(shown),
      links: links.map((l) => ({ _id: l._id, shopifyVariantId: l.shopifyVariantId, title: l.title, cjName: l.cjName, cjPid: l.cjPid, cjImage: l.cjImage })),
    };
  },
});

export const setSettings = mutation({
  args: { autopilot: v.boolean(), payFromBalance: v.boolean() },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const row = await ctx.db.query("orderSettings").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (row) await ctx.db.patch("orderSettings", row._id, args);
    else await ctx.db.insert("orderSettings", { userId: user._id, ...args });
    if (args.autopilot) await ctx.scheduler.runAfter(0, internal.orders.syncUser, { userId: user._id });
  },
});

/** Links a Shopify variant to a CJ variant; orders waiting for that link get it. */
export const link = mutation({
  args: { shopifyVariantId: v.string(), title: v.string(), cjPid: v.string(), cjVid: v.string(), cjName: v.string(), cjImage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first." });
    const old = await ctx.db.query("cjLinks").withIndex("by_user_variant", (q) => q.eq("userId", user._id).eq("shopifyVariantId", args.shopifyVariantId)).unique();
    const row = { ...args, shopDomain: store.shopDomain, title: args.title.slice(0, 160), cjName: args.cjName.slice(0, 160) };
    if (old) await ctx.db.patch("cjLinks", old._id, row);
    else await ctx.db.insert("cjLinks", { userId: user._id, ...row });
    const waiting = await ctx.db.query("cjOrders").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "needs_link")).take(100);
    for (const o of waiting) {
      const items = o.items.map((i) => (i.variantId === args.shopifyVariantId ? { ...i, cjVid: args.cjVid, cjName: args.cjName } : i));
      await ctx.db.patch("cjOrders", o._id, { items, updatedAt: Date.now() });
      if (items.every((i) => i.cjVid)) await ctx.scheduler.runAfter(0, internal.orders.quote, { id: o._id });
    }
  },
});

export const unlink = mutation({
  args: { id: v.id("cjLinks") },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    const l = await ctx.db.get("cjLinks", args.id);
    if (!user || !l || l.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Link not found." });
    await ctx.db.delete("cjLinks", l._id);
  },
});

async function ownOrder(ctx: QueryCtx, id: Id<"cjOrders">) {
  const user = await me(ctx);
  const o = await ctx.db.get("cjOrders", id);
  if (!user || !o || o.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Order not found." });
  return o;
}

/** The user's OK: the order goes to CJ. */
export const approve = mutation({
  args: { id: v.id("cjOrders") },
  handler: async (ctx, args) => {
    const o = await ownOrder(ctx, args.id);
    if (o.status !== "waiting" && o.status !== "failed") throw new ConvexError({ code: "BAD_STATE", message: "This order can't be sent to CJ now." });
    if (!o.shipTo) throw new ConvexError({ code: "NO_ADDRESS", message: "This order has no shipping address." });
    if (!o.items.every((i) => i.cjVid)) throw new ConvexError({ code: "NEEDS_LINK", message: "Link every item to a CJ product first." });
    await ctx.db.patch("cjOrders", o._id, { status: "placing", error: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.orders.place, { id: o._id });
  },
});

/** Not via CJ: it leaves the list, and its address is deleted. */
export const reject = mutation({
  args: { id: v.id("cjOrders") },
  handler: async (ctx, args) => {
    const o = await ownOrder(ctx, args.id);
    if (o.status === "placing" || o.status === "placed" || o.status === "shipped") throw new ConvexError({ code: "BAD_STATE", message: "This order is already at CJ." });
    await ctx.db.patch("cjOrders", o._id, { status: "rejected", shipTo: undefined, updatedAt: Date.now() });
  },
});

// ── Background work ──

export const context = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!store) return null;
    const links = await ctx.db.query("cjLinks").withIndex("by_user_variant", (q) => q.eq("userId", args.userId)).take(500);
    return { store, settings: await settingsOf(ctx, args.userId), links: Object.fromEntries(links.map((l) => [l.shopifyVariantId, { cjVid: l.cjVid, cjName: l.cjName }])) };
  },
});

export const known = internalQuery({
  args: { shopDomain: v.string(), shopifyOrderIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out: string[] = [];
    for (const id of args.shopifyOrderIds) {
      if (await ctx.db.query("cjOrders").withIndex("by_shop_order", (q) => q.eq("shopDomain", args.shopDomain).eq("shopifyOrderId", id)).first()) out.push(id);
    }
    return out;
  },
});

const shipToV = v.object({
  name: v.string(), address1: v.string(), address2: v.optional(v.string()), city: v.string(), province: v.optional(v.string()), zip: v.optional(v.string()),
  country: v.string(), countryCode: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()),
});
const itemV = v.object({ lineItemId: v.string(), variantId: v.string(), productId: v.optional(v.string()), title: v.string(), quantity: v.number(), cjVid: v.optional(v.string()), cjName: v.optional(v.string()) });

export const add = internalMutation({
  args: { userId: v.id("users"), shopDomain: v.string(), shopifyOrderId: v.string(), orderName: v.string(), createdAt: v.string(), shipTo: v.union(shipToV, v.null()), items: v.array(itemV) },
  handler: async (ctx, args): Promise<Id<"cjOrders"> | null> => {
    if (await ctx.db.query("cjOrders").withIndex("by_shop_order", (q) => q.eq("shopDomain", args.shopDomain).eq("shopifyOrderId", args.shopifyOrderId)).first()) return null;
    const linked = args.items.every((i) => i.cjVid);
    return ctx.db.insert("cjOrders", {
      userId: args.userId,
      shopDomain: args.shopDomain,
      shopifyOrderId: args.shopifyOrderId,
      orderName: args.orderName,
      createdAt: args.createdAt,
      status: !args.shipTo ? "no_address" : linked ? "quoting" : "needs_link",
      ...(args.shipTo ? { shipTo: args.shipTo, shipToLabel: `${args.shipTo.city}, ${args.shipTo.countryCode}` } : {}),
      items: args.items,
      updatedAt: Date.now(),
    });
  },
});

/** Every 30 minutes (crons.ts) for users with the autopilot on, and from the page's "Check for orders". */
export const syncUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ added: number } | { skipped: string }> => {
    const c = await ctx.runQuery(internal.orders.context, { userId: args.userId });
    if (!c) return { skipped: "no store" };
    if (!c.settings.autopilot) return { skipped: "autopilot off" };
    if (!hasScopes(c.store.scopes, ORDER_SCOPES)) return { skipped: "needs permissions" };
    const token = await decryptToken(c.store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
    const since = new Date(Date.now() - LOOK_BACK_DAYS * 86_400_000).toISOString();
    const open = openOrders(await orderGql(c.store.shopDomain, token, OPEN_ORDERS_QUERY, { q: openOrdersSearch(since) }));
    const seen = new Set(await ctx.runQuery(internal.orders.known, { shopDomain: c.store.shopDomain, shopifyOrderIds: open.map((o) => o.id) }));
    let added = 0;
    for (const o of open.filter((x) => !seen.has(x.id))) {
      const items: LinkedItem[] = o.items.map((i) => ({ ...i, ...(c.links[i.variantId] ?? {}) }));
      const id = await ctx.runMutation(internal.orders.add, { userId: args.userId, shopDomain: c.store.shopDomain, shopifyOrderId: o.id, orderName: o.name, createdAt: o.createdAt, shipTo: o.shipTo, items });
      if (id) {
        added++;
        if (o.shipTo && items.every((i) => i.cjVid)) await ctx.scheduler.runAfter(added * 1500, internal.orders.quote, { id });
      }
    }
    return { added };
  },
});

export const sync = action({
  args: {},
  handler: async (ctx): Promise<{ added: number } | { skipped: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    try {
      return await ctx.runAction(internal.orders.syncUser, { userId: user._id });
    } catch (e) {
      if (e instanceof ShopifyError) throw new ConvexError({ code: e.code, message: e.message });
      throw e;
    }
  },
});

export const getOrder = internalQuery({
  args: { id: v.id("cjOrders") },
  handler: async (ctx, args) => {
    const o = await ctx.db.get("cjOrders", args.id);
    if (!o) return null;
    return { order: o, settings: await settingsOf(ctx, o.userId), store: await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", o.userId)).unique() };
  },
});

export const patchOrder = internalMutation({
  args: { id: v.id("cjOrders"), patch: v.any() },
  handler: async (ctx, args) => {
    const p = args.patch as Partial<Doc<"cjOrders">> & { clearAddress?: boolean };
    const { clearAddress, ...rest } = p;
    await ctx.db.patch("cjOrders", args.id, { ...rest, ...(clearAddress ? { shipTo: undefined } : {}), updatedAt: Date.now() });
  },
});

/** The cheapest CJ shipping for the whole order to its country; then it waits for the user's OK. */
export const quote = internalAction({
  args: { id: v.id("cjOrders") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.orders.getOrder, { id: args.id });
    if (!c?.order.shipTo || !c.order.items.every((i) => i.cjVid)) return;
    const token = await accessToken(ctx);
    if (!token) return void (await ctx.runMutation(internal.orders.patchOrder, { id: args.id, patch: { status: "failed", error: "CJ isn't connected (CJ_API_KEY)." } }));
    const options = cjShippingOptions(
      await cj(token, "/logistic/freightCalculate", {
        method: "POST",
        body: { startCountryCode: "CN", endCountryCode: c.order.shipTo.countryCode, products: c.order.items.map((i) => ({ quantity: i.quantity, vid: i.cjVid })) },
      }),
    );
    await ctx.runMutation(internal.orders.patchOrder, {
      id: args.id,
      patch: options
        ? { status: "waiting", shipping: { ...options.cheapest, from: "CN" } }
        : { status: "failed", error: `CJ has no shipping to ${c.order.shipTo.countryCode} for these items.` },
    });
  },
});

/** Creates the approved order at CJ; its address is deleted once CJ has it. */
export const place = internalAction({
  args: { id: v.id("cjOrders") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.orders.getOrder, { id: args.id });
    if (!c || c.order.status !== "placing") return;
    const fail = (error: string) => ctx.runMutation(internal.orders.patchOrder, { id: args.id, patch: { status: "failed", error } });
    const { order } = c;
    if (!order.shipTo || !order.shipping) return void (await fail("The order has no address or shipping quote."));
    const token = await accessToken(ctx);
    if (!token) return void (await fail("CJ isn't connected (CJ_API_KEY)."));
    const body = cjOrderBody({ name: order.orderName, shipTo: order.shipTo as ShipTo, items: order.items, logisticName: order.shipping.method, fromCountryCode: order.shipping.from }, c.settings.payFromBalance);
    const made = cjOrderMade(await cj(token, "/shopping/order/createOrderV2", { method: "POST", body }));
    if (!made) return void (await fail("CJ didn't take the order. Check your CJ account (balance, address) and try again."));
    await ctx.runMutation(internal.orders.patchOrder, {
      id: args.id,
      patch: { status: "placed", cjOrderId: made.orderId, ...(made.costUsd !== undefined ? { cjCostUsd: made.costUsd } : {}), paid: c.settings.payFromBalance, clearAddress: true },
    });
  },
});

export const placedOrders = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("cjOrders").withIndex("by_status", (q) => q.eq("status", "placed")).take(200),
});

/** Hourly (crons.ts): CJ's tracking numbers to Shopify (which emails the customer). */
export const trackAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ shipped: number }> => {
    const placed = await ctx.runQuery(internal.orders.placedOrders, {});
    if (!placed.length) return { shipped: 0 };
    const token = await accessToken(ctx);
    if (!token) return { shipped: 0 };
    let shipped = 0;
    for (const o of placed) {
      if (!o.cjOrderId) continue;
      await pause();
      const tracking = cjTracking(await cj(token, `/shopping/order/getOrderDetail?${new URLSearchParams({ orderId: o.cjOrderId })}`));
      if (!tracking) continue;
      const c = await ctx.runQuery(internal.orders.getOrder, { id: o._id });
      if (!c?.store) continue;
      try {
        const shopToken = await decryptToken(c.store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
        const fos = await orderGql(c.store.shopDomain, shopToken, FULFILLMENT_ORDERS_QUERY, { id: o.shopifyOrderId });
        const input = fulfillmentInput(fos, o.items.map((i) => i.lineItemId), tracking);
        if (input) {
          const r = await orderGql<{ fulfillmentCreate?: { fulfillment: { id: string } | null; userErrors: { message: string }[] } }>(c.store.shopDomain, shopToken, FULFILLMENT_CREATE, { fulfillment: input });
          const errs = r.fulfillmentCreate?.userErrors ?? [];
          if (!r.fulfillmentCreate?.fulfillment) {
            await ctx.runMutation(internal.orders.patchOrder, { id: o._id, patch: { error: `Shopify didn't take the tracking: ${errs.map((e) => e.message).join("; ") || "no reason"}`.slice(0, 300) } });
            continue;
          }
        }
        await ctx.runMutation(internal.orders.patchOrder, { id: o._id, patch: { status: "shipped", tracking, error: undefined } });
        shipped++;
      } catch (e) {
        await ctx.runMutation(internal.orders.patchOrder, { id: o._id, patch: { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
      }
    }
    return { shipped };
  },
});

export const autopilotUsers = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("orderSettings").take(1000)).filter((s) => s.autopilot).map((s) => s.userId),
});

export const syncAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ users: number }> => {
    const users = await ctx.runQuery(internal.orders.autopilotUsers, {});
    for (const [i, userId] of users.entries()) await ctx.scheduler.runAfter(i * 3000, internal.orders.syncUser, { userId });
    return { users: users.length };
  },
});

/** Shopify's privacy webhooks: a customer's orders (addresses and all) or the whole store's order data go. */
export const redact = internalMutation({
  args: { shopDomain: v.string(), shopifyOrderIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("cjOrders").withIndex("by_shop_order", (q) => q.eq("shopDomain", args.shopDomain)).take(5000);
    const only = args.shopifyOrderIds ? new Set(args.shopifyOrderIds) : null;
    for (const r of rows) if (!only || only.has(r.shopifyOrderId)) await ctx.db.delete("cjOrders", r._id);
    if (!only) {
      for (const l of await ctx.db.query("cjLinks").withIndex("by_shop", (q) => q.eq("shopDomain", args.shopDomain)).take(5000)) await ctx.db.delete("cjLinks", l._id);
      for (const d of await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", args.shopDomain)).take(5000)) await ctx.db.delete("profitDays", d._id);
    }
  },
});
