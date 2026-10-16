import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { NoAccess, adminGql } from "./lib/shopifyAdmin";
import { decryptToken } from "./lib/shopifyOAuth";
import { countOrdersWith, missingOrderScope, MAX_ORDER_PAGES, ORDER_DAYS, ORDER_LINE_ITEMS, ORDER_PAGE, ORDERS_CACHE_MS } from "./lib/ownOrders";

// Research verdict: orders of a launched product in the user's own store over
// the last 30 days (needs read_orders). Cached on the launch for 12 hours.

export type OwnOrders = { orders?: number; capped?: boolean; reason?: "no_launch" | "no_scope" | "pasted_token" | "error" };

export const context = internalQuery({
  args: { userId: v.id("users"), productId: v.union(v.id("products"), v.id("importedProducts")) },
  handler: async (ctx, args) => {
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!store) return null;
    const launches = await ctx.db.query("launches").withIndex("by_user_product", (q) => q.eq("userId", args.userId).eq("productId", args.productId)).order("desc").take(20);
    const launch = launches.find((l) => l.status === "published" && l.shopifyProductId && l.shopDomain === store.shopDomain);
    if (!launch) return null;
    return {
      launchId: launch._id,
      shopifyProductId: launch.shopifyProductId!,
      cached: launch.ownOrdersAt && launch.ownOrders30d !== undefined
        ? { at: launch.ownOrdersAt, orders: launch.ownOrders30d, capped: launch.ownOrdersCapped ?? false }
        : null,
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      oauth: store.via === "oauth",
      scopes: store.scopes,
    };
  },
});

export const remember = internalMutation({
  args: { launchId: v.id("launches"), orders: v.number(), capped: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch("launches", args.launchId, { ownOrders30d: args.orders, ownOrdersAt: new Date().toISOString(), ownOrdersCapped: args.capped });
  },
});

type OrdersPage = { orders: { nodes: { lineItems: { nodes: { product: { id: string } | null }[] } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

const ORDERS = `query($after: String, $q: String) { orders(first: ${ORDER_PAGE}, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
  nodes { lineItems(first: ${ORDER_LINE_ITEMS}) { nodes { product { id } } } } pageInfo { hasNextPage endCursor } } }`;

export const forProduct = internalAction({
  args: { userId: v.id("users"), productId: v.union(v.id("products"), v.id("importedProducts")) },
  handler: async (ctx, args): Promise<OwnOrders> => {
    const c = await ctx.runQuery(internal.ownOrders.context, args);
    if (!c) return { reason: "no_launch" };
    if (missingOrderScope(c.scopes)) return { reason: "no_scope" };
    if (c.cached && Date.now() - Date.parse(c.cached.at) < ORDERS_CACHE_MS) return { orders: c.cached.orders, capped: c.cached.capped };
    try {
      const token = await decryptToken(c.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      const since = new Date(Date.now() - ORDER_DAYS * 86_400_000).toISOString();
      let orders = 0;
      let after: string | null = null;
      let capped = false;
      for (let page = 1; ; page++) {
        const data: OrdersPage = await adminGql<OrdersPage>(c.shopDomain, token, ORDERS, { after, q: `created_at:>='${since}'` });
        orders += countOrdersWith(data.orders.nodes, c.shopifyProductId);
        if (!data.orders.pageInfo.hasNextPage) break;
        if (page >= MAX_ORDER_PAGES) {
          capped = true;
          break;
        }
        after = data.orders.pageInfo.endCursor;
      }
      await ctx.runMutation(internal.ownOrders.remember, { launchId: c.launchId, orders, capped });
      return { orders, capped };
    } catch (e) {
      if (e instanceof NoAccess) {
        // read_orders is already granted (e.g. protected customer data not approved): a reconnect would not help.
        if (c.oauth && c.scopes !== undefined) return { reason: "error" };
        return { reason: c.oauth ? "no_scope" : "pasted_token" };
      }
      console.warn("Own-store orders failed", e instanceof Error ? e.message.slice(0, 200) : e);
      return { reason: "error" };
    }
  },
});
