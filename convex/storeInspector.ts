import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan } from "./lib/billing";
import { productUrl } from "./lib/productImport";
import { firstProductPath, inspectHtml, mergeInspections, type Inspection } from "./lib/storeInspect";
import { FREE_WATCHED_STORES, PRO_WATCHED_STORES } from "./stores";

// Store Inspector: paste a store's link, see its theme and apps (lib/storeInspect.ts),
// and add it to the store watchlist. Results are cached per store for 12 hours.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const CACHE_MS = 12 * 3_600_000;
export const FREE_INSPECTIONS_PER_DAY = 5;
export const PRO_INSPECTIONS_PER_DAY = 100;

async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

async function userByToken(ctx: { db: QueryCtx["db"] }, token: string): Promise<Doc<"users"> | null> {
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", token)).unique();
}

/** Today's inspections by the user and their limit; a fresh cached result of the store, if any. */
export const before = internalQuery({
  args: { token: v.string(), host: v.string() },
  handler: async (ctx, args) => {
    const user = await userByToken(ctx, args.token);
    if (!user) return null;
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const limit = user.role === "admin" ? 1000 : effectivePlan(user) === "none" ? FREE_INSPECTIONS_PER_DAY : PRO_INSPECTIONS_PER_DAY;
    const today = await ctx.db
      .query("storeInspections")
      .withIndex("by_user", (q) => q.eq("userId", user._id).gt("inspectedAt", since))
      .take(limit);
    const cached = await ctx.db.query("storeInspections").withIndex("by_host", (q) => q.eq("host", args.host)).order("desc").first();
    const fresh = cached && Date.now() - Date.parse(cached.inspectedAt) < CACHE_MS ? (cached.result as Inspection) : null;
    return { userId: user._id, used: today.length, limit, fresh };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), host: v.string(), url: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    return ctx.db.insert("storeInspections", { ...args, inspectedAt: new Date().toISOString() });
  },
});

export const inspect = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<{ id: Id<"storeInspections">; host: string; result: Inspection }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const u = productUrl(args.url.trim().match(/^https?:\/\//i) ? args.url.trim() : `https://${args.url.trim()}`);
    if (!u) throw new ConvexError({ code: "BAD_LINK", message: "Paste a store's address, like https://store.com" });
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const pre = await ctx.runQuery(internal.storeInspector.before, { token: stableToken(identity), host });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (pre.used >= pre.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message: pre.limit === FREE_INSPECTIONS_PER_DAY ? `Free accounts can inspect ${pre.limit} stores a day. Upgrade to Pro for ${PRO_INSPECTIONS_PER_DAY}.` : `You've inspected ${pre.limit} stores today. Try again tomorrow.`,
      });
    }
    let result = pre.fresh;
    if (!result) {
      // The link they pasted, the home page and one product page: apps often load on only some pages.
      const origin = `${u.protocol}//${u.host}`;
      const urls = [...new Set([u.toString(), `${origin}/`])];
      const pages = (await Promise.all(urls.map(page))).filter((h): h is string => !!h);
      if (!pages.length) throw new ConvexError({ code: "UNREACHABLE", message: `We couldn't open ${host}. Check the address and try again.` });
      const productPath = pages.map(firstProductPath).find(Boolean);
      if (productPath && !urls.some((x) => x.includes("/products/"))) {
        const p = await page(`${origin}${productPath}`);
        if (p) pages.push(p);
      }
      result = mergeInspections(pages.map(inspectHtml));
      if (!result.shopify) throw new ConvexError({ code: "NOT_SHOPIFY", message: `${host} doesn't look like a Shopify store. The Inspector reads Shopify stores only.` });
    }
    const id = await ctx.runMutation(internal.storeInspector.save, { userId: pre.userId, host, url: `https://${host}`, result });
    return { id, host, result };
  },
});

/** The user's last inspections, newest first, one per store. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await userByToken(ctx, stableToken(identity));
    if (!user) return [];
    const rows = await ctx.db.query("storeInspections").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(60);
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.host)) continue;
      seen.add(r.host);
      const store = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", r.host)).first();
      const tracked = store
        ? !!(await ctx.db.query("trackedStores").withIndex("by_user_and_store", (q) => q.eq("userId", user._id).eq("storeId", store._id)).unique())
        : false;
      out.push({ _id: r._id, host: r.host, inspectedAt: r.inspectedAt, result: r.result as Inspection, storeId: store?._id ?? null, tracked });
      if (out.length >= 12) break;
    }
    return out;
  },
});

/**
 * Adds an inspected store to the user's watchlist: finds it among our stores by its address,
 * or adds it (sales tracking then fills in its catalog), and tracks it.
 */
export const track = mutation({
  args: { inspectionId: v.id("storeInspections") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const user = await userByToken(ctx, stableToken(identity));
    const row = await ctx.db.get("storeInspections", args.inspectionId);
    if (!user || !row || row.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Inspect the store first." });
    const result = row.result as Inspection;
    let store = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", row.host)).first();
    if (!store) {
      const storeId = await ctx.db.insert("stores", {
        name: (result.shopName || row.host).slice(0, 80),
        url: row.url,
        host: row.host,
        logoUrl: "",
        niche: "Other",
        country: result.country ?? "",
        platform: "Shopify",
        estimatedRevenueRange: "Unknown",
        trafficRange: "Unknown",
        activeAdsCount: 0,
        bestSellers: [],
        isHighTraffic: false,
        spottedAt: new Date().toISOString(),
        source: "inspector",
      });
      store = (await ctx.db.get("stores", storeId))!;
    }
    const already = await ctx.db.query("trackedStores").withIndex("by_user_and_store", (q) => q.eq("userId", user._id).eq("storeId", store._id)).unique();
    if (already) return { storeId: store._id, tracked: true };
    const max = user.role === "admin" ? 500 : effectivePlan(user) === "none" ? FREE_WATCHED_STORES : PRO_WATCHED_STORES;
    const count = (await ctx.db.query("trackedStores").withIndex("by_user", (q) => q.eq("userId", user._id)).take(max)).length;
    if (count >= max) {
      throw new ConvexError({
        code: "LIMIT",
        message: max === FREE_WATCHED_STORES ? `Free accounts can watch ${max} stores. Upgrade to Pro (or start the free trial) to watch up to ${PRO_WATCHED_STORES}.` : `You can watch up to ${max} stores. Remove one first.`,
      });
    }
    await ctx.db.insert("trackedStores", { userId: user._id, storeId: store._id, trackedAt: new Date().toISOString() });
    await ctx.scheduler.runAfter(0, internal.storeSales.checkOne, { storeId: store._id });
    return { storeId: store._id, tracked: true };
  },
});
