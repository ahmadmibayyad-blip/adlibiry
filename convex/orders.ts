import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { decryptToken } from "./lib/shopifyOAuth";
import { orderGql, ShopifyError } from "./lib/shopifyOrderApi";
import { ORDERS_QUERY, ORDERS_QUERY_BASIC, orderSummary, ordersSearch, trackedOrders, type TrackedOrder } from "./lib/orderTracker";

// Orders (/dashboard/orders): the store's last 30 days of orders as Shopify knows them, whoever fulfills them (the
// owner's fulfillment app, an agent, or by hand), with the ones that need a look (lib/orderTracker.ts). Read live from
// Shopify when the page asks; nothing is stored, and no customer fields are read.

export const ORDER_SCOPES = ["read_orders"];
const LOOK_BACK_DAYS = 30;
const MAX_PAGES = 3;
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

/** Whether the page can load orders: a connected store that allows reading them. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await me(ctx);
    if (!user) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return { store: store ? { shopName: store.shopName, canUse: hasScopes(store.scopes, ORDER_SCOPES) } : null };
  },
});

export const storeFor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await me(ctx);
    if (!user) return null;
    return ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
  },
});

/** The orders and what needs a look, straight from Shopify. */
export const load = action({
  args: {},
  handler: async (ctx): Promise<{ orders: TrackedOrder[]; summary: ReturnType<typeof orderSummary>; capped: boolean }> => {
    const store = await ctx.runQuery(internal.orders.storeFor, {});
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first." });
    if (!hasScopes(store.scopes, ORDER_SCOPES)) throw new ConvexError({ code: "ACCESS", message: "Reconnect your store in Settings → Shopify so AdSpy can read your orders." });
    try {
      const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      const q = ordersSearch(new Date(Date.now() - LOOK_BACK_DAYS * 86_400_000).toISOString());
      const orders: TrackedOrder[] = [];
      let after: string | null = null;
      let query = ORDERS_QUERY;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await orderGql(store.shopDomain, token, query, { q, after }).catch((e: unknown) => {
          // A store that didn't allow fulfillment orders still shows its orders, without where each is assigned.
          if (!(e instanceof ShopifyError) || e.code !== "ACCESS" || query === ORDERS_QUERY_BASIC) throw e;
          query = ORDERS_QUERY_BASIC;
          return orderGql(store.shopDomain, token, query, { q, after });
        });
        const r = trackedOrders(body);
        orders.push(...r.orders);
        after = r.next;
        if (!after) break;
      }
      return { orders, summary: orderSummary(orders), capped: after !== null };
    } catch (e) {
      if (e instanceof ShopifyError) throw new ConvexError({ code: e.code, message: e.message });
      throw e;
    }
  },
});

/**
 * Shopify's privacy webhooks (shopifyApp.ts). Orders keeps nothing now; this clears what the old CJ autopilot kept
 * (cjOrders with addresses, cjLinks) and the store's profit days.
 */
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
