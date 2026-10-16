import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { decryptToken } from "./lib/shopifyOAuth";
import { orderGql, localDay, ShopifyError } from "./lib/shopifyOrderApi";
import { withPegged } from "./lib/currency";
import { DEFAULT_PROFIT_SETTINGS, ORDERS_QUERY, dayProfit, ordersSearch, profitDays, profitOrders, type ProfitDay } from "./lib/profit";

// Profit (lib/profit.ts): each day's orders from the user's Shopify store minus their costs, kept per store and day
// in profitDays. Hourly the last two days are brought up to date for every store that allows reading orders
// (read_orders); the page can recount the last 30. Ad spend is what the user types in per day.

export const PROFIT_SCOPES = ["read_orders"];
const DAY_MS = 86_400_000;
const hasScopes = (granted: string | undefined, need: string[]) => {
  if (granted === undefined) return true; // a pasted token: unknown, so try
  const have = new Set(granted.split(",").map((s) => s.trim()));
  return need.every((s) => have.has(s));
};

async function me(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function settingsOf(ctx: QueryCtx, userId: Id<"users">) {
  const row = await ctx.db.query("profitSettings").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  return { feePercent: row?.feePercent ?? DEFAULT_PROFIT_SETTINGS.feePercent, feeFixed: row?.feeFixed ?? DEFAULT_PROFIT_SETTINGS.feeFixed, shippingPerOrder: row?.shippingPerOrder ?? DEFAULT_PROFIT_SETTINGS.shippingPerOrder };
}

/** The last `days` days of the user's store, newest last, with profit counted. */
export const mine = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) return { store: null };
    const days = Math.min(90, Math.max(1, Math.round(args.days ?? 30)));
    const since = new Date(Date.now() - (days + 1) * DAY_MS).toISOString().slice(0, 10);
    const rows = await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", store.shopDomain).gte("day", since)).take(100);
    return {
      store: { shopDomain: store.shopDomain, shopName: store.shopName, currency: store.currency ?? "USD", canRead: hasScopes(store.scopes, PROFIT_SCOPES) },
      settings: await settingsOf(ctx, user._id),
      days: rows.map((r) => ({ ...dayOf(r), profit: dayProfit(r, r.adSpend ?? 0) })),
    };
  },
});

const dayOf = (r: Doc<"profitDays">) => ({
  day: r.day, orders: r.orders, revenue: r.revenue, productCost: r.productCost, shippingCost: r.shippingCost, fees: r.fees,
  missingCost: r.missingCost, top: r.top, adSpend: r.adSpend, updatedAt: r.updatedAt,
});

export const setAdSpend = mutation({
  args: { day: v.string(), amount: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.day)) throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a day." });
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first." });
    const amount = args.amount === null ? undefined : Math.max(0, Math.round(args.amount * 100) / 100);
    const row = await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", store.shopDomain).eq("day", args.day)).unique();
    if (row) await ctx.db.patch("profitDays", row._id, { adSpend: amount });
    else await ctx.db.insert("profitDays", { userId: user._id, shopDomain: store.shopDomain, day: args.day, currency: store.currency ?? "USD", orders: 0, revenue: 0, productCost: 0, shippingCost: 0, fees: 0, missingCost: 0, top: [], adSpend: amount, updatedAt: Date.now() });
  },
});

export const setSettings = mutation({
  args: { feePercent: v.number(), feeFixed: v.number(), shippingPerOrder: v.number() },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const clean = { feePercent: Math.min(20, Math.max(0, args.feePercent)), feeFixed: Math.min(10, Math.max(0, args.feeFixed)), shippingPerOrder: Math.min(100, Math.max(0, args.shippingPerOrder)) };
    const row = await ctx.db.query("profitSettings").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (row) await ctx.db.patch("profitSettings", row._id, clean);
    else await ctx.db.insert("profitSettings", { userId: user._id, ...clean });
  },
});

/** What a recount needs: the store, the settings, product costs AdSpy knows (per Shopify product) and CJ order costs. */
export const context = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!store) return null;
    const currency = store.currency ?? "USD";
    const fx = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fxRates")).unique();
    const rate = currency === "USD" ? 1 : (withPegged((fx?.data as { all?: Record<string, number> } | undefined)?.all ?? {})[currency] ?? 0);
    // Products AdSpy launched: their supplier cost (USD, shipping estimate included), in the store's currency.
    const costs: Record<string, number> = {};
    if (rate > 0) {
      const launches = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", args.userId)).take(200);
      for (const l of launches) {
        if (!l.shopifyProductId || costs[l.shopifyProductId]) continue;
        const catalogId = ctx.db.normalizeId("products", l.productId);
        const importedId = ctx.db.normalizeId("importedProducts", l.productId);
        const p = catalogId ? await ctx.db.get("products", catalogId) : importedId ? await ctx.db.get("importedProducts", importedId) : null;
        const cost = p?.cost;
        if (cost && cost > 0) costs[l.shopifyProductId] = Math.round(cost * rate * 100) / 100;
      }
    }
    // Orders CJ fulfilled: what CJ charged (USD), in the store's currency.
    const orderCosts: Record<string, number> = {};
    if (rate > 0) {
      for (const o of await ctx.db.query("cjOrders").withIndex("by_user", (q) => q.eq("userId", args.userId)).order("desc").take(500)) {
        if (o.cjCostUsd !== undefined) orderCosts[o.shopifyOrderId] = Math.round(o.cjCostUsd * rate * 100) / 100;
      }
    }
    return {
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      currency,
      canRead: hasScopes(store.scopes, PROFIT_SCOPES),
      settings: await settingsOf(ctx, args.userId),
      costs,
      orderCosts,
    };
  },
});

export const saveDays = internalMutation({
  args: { userId: v.id("users"), shopDomain: v.string(), currency: v.string(), days: v.array(v.any()), from: v.string() },
  handler: async (ctx, args) => {
    const counted = new Set<string>();
    for (const d of args.days as ProfitDay[]) {
      counted.add(d.day);
      const row = await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", args.shopDomain).eq("day", d.day)).unique();
      const fields = { orders: d.orders, revenue: d.revenue, productCost: d.productCost, shippingCost: d.shippingCost, fees: d.fees, missingCost: d.missingCost, top: d.top, currency: args.currency, updatedAt: Date.now() };
      // The ad spend the user typed in stays.
      if (row) await ctx.db.patch("profitDays", row._id, fields);
      else await ctx.db.insert("profitDays", { userId: args.userId, shopDomain: args.shopDomain, day: d.day, ...fields });
    }
    // Days in the range without orders (any more): zero, keeping their ad spend.
    const rows = await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", args.shopDomain).gte("day", args.from)).take(200);
    for (const r of rows) {
      if (!counted.has(r.day) && r.orders) await ctx.db.patch("profitDays", r._id, { orders: 0, revenue: 0, productCost: 0, shippingCost: 0, fees: 0, missingCost: 0, top: [], updatedAt: Date.now() });
    }
  },
});

/** Recounts the user's last `days` days from Shopify. */
export const recount = internalAction({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx, args): Promise<{ days: number } | { skipped: string }> => {
    const c = await ctx.runQuery(internal.profit.context, { userId: args.userId });
    if (!c) return { skipped: "no store" };
    if (!c.canRead) return { skipped: "needs read_orders" };
    const token = await decryptToken(c.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
    const fromMs = Date.now() - (args.days + 1) * DAY_MS; // a day extra: the store's own day can start before ours
    const q = ordersSearch(new Date(fromMs).toISOString(), new Date(Date.now() + DAY_MS).toISOString());
    const orders = [];
    let after: string | null = null;
    let timeZone = "UTC";
    for (let page = 0; page < 30; page++) {
      const data: { shop?: { ianaTimezone?: string }; orders?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } = await orderGql(c.shopDomain, token, ORDERS_QUERY, { q, after });
      timeZone = data.shop?.ianaTimezone ?? timeZone;
      orders.push(...profitOrders(data.orders?.nodes ?? []));
      if (!data.orders?.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }
    const days = profitDays(orders, timeZone, c.settings, (id) => c.costs[id], (id) => c.orderCosts[id]);
    await ctx.runMutation(internal.profit.saveDays, { userId: args.userId, shopDomain: c.shopDomain, currency: c.currency, days, from: localDay(fromMs + DAY_MS, timeZone) });
    return { days: days.length };
  },
});

/** The page's Refresh: the last 30 days now. */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ days: number } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    try {
      return await ctx.runAction(internal.profit.recount, { userId: user._id, days: 30 });
    } catch (e) {
      if (e instanceof ShopifyError) throw new ConvexError({ code: e.code, message: e.message });
      throw e;
    }
  },
});

export const storesToCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("shopifyConnections").take(500);
    return rows.filter((s) => s.via === "oauth" && hasScopes(s.scopes, PROFIT_SCOPES)).map((s) => s.userId);
  },
});

/** Hourly (crons.ts): yesterday and today for every store that allows it. */
export const recountAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ stores: number }> => {
    const users = await ctx.runQuery(internal.profit.storesToCount, {});
    for (const [i, userId] of users.entries()) await ctx.scheduler.runAfter(i * 2000, internal.profit.recount, { userId, days: 2 });
    return { stores: users.length };
  },
});

/** Yesterday's profit in the user's store, for the morning email (null without orders or a store). */
export const yesterdayFor = internalQuery({
  args: { userId: v.id("users"), day: v.string() },
  handler: async (ctx, args) => {
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!store) return null;
    const r = await ctx.db.query("profitDays").withIndex("by_shop_day", (q) => q.eq("shopDomain", store.shopDomain).eq("day", args.day)).unique();
    if (!r || !r.orders) return null;
    return { ...dayOf(r), currency: r.currency, profit: dayProfit(r, r.adSpend ?? 0), shopName: store.shopName };
  },
});
