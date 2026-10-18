import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import { productUrl } from "./lib/productImport";
import { firstProductPath, inspectHtml, mergeInspections, type Inspection } from "./lib/storeInspect";
import { fetchPage as page, teardownAt } from "./lib/pageFetch";
import type { Teardown } from "./lib/storeTeardown";
import { cdxUrl, storeHistory, type StoreHistory } from "./lib/storeHistory";
import type { StoreAd, StoreAnalysis } from "./lib/storeAnalysis";
import { watchLimit, watchLimitMessage } from "./stores";
import { techFromInspection } from "./storeTech";

// Store Inspector: paste a store's link, see its theme and apps (lib/storeInspect.ts) and a
// teardown of its main product page (lib/storeTeardown.ts: bundle tiers, reviews, price,
// conversion features, section order), and add it to the store watchlist.
// Results are cached per store for 12 hours.

const CACHE_MS = 12 * 3_600_000;
export const FREE_INSPECTIONS_PER_DAY = 5;
export const PRO_INSPECTIONS_PER_DAY = 100;
export const TRIAL_INSPECTIONS_PER_DAY = 20;

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
    const limit = byTier(user, { admin: 1000, paid: PRO_INSPECTIONS_PER_DAY, trial: TRIAL_INSPECTIONS_PER_DAY, free: FREE_INSPECTIONS_PER_DAY });
    const today = await ctx.db
      .query("storeInspections")
      .withIndex("by_user", (q) => q.eq("userId", user._id).gt("inspectedAt", since))
      .take(limit);
    const cached = await ctx.db.query("storeInspections").withIndex("by_host", (q) => q.eq("host", args.host)).order("desc").first();
    // Results from before the teardown existed are read again.
    const result = cached?.result as Inspection | undefined;
    const fresh = cached && result && result.teardown !== undefined && result.history !== undefined && result.domain !== undefined && Date.now() - Date.parse(cached.inspectedAt) < CACHE_MS ? result : null;
    return { userId: user._id, used: today.length, limit, fresh };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), host: v.string(), url: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    const inspectedAt = new Date().toISOString();
    // The Stores page's theme/app/pixel filters read it off the listed store.
    await techFromInspection(ctx, args.host, args.result as Inspection, inspectedAt);
    return ctx.db.insert("storeInspections", { ...args, inspectedAt });
  },
});

/** The store's saved copies in the Wayback Machine; null when it doesn't answer in time. */
async function archiveHistory(host: string): Promise<StoreHistory | null> {
  try {
    const res = await fetch(cdxUrl(host), { signal: AbortSignal.timeout(35_000) });
    return res.ok ? storeHistory(await res.json().catch(() => null), host) : null;
  } catch {
    return null;
  }
}

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
      // The archive is slow (often 10-30 s): asked at the same time as the pages.
      const historyLater = archiveHistory(host);
      const domainLater = ctx.runAction(internal.domainInfo.registered, { host }).catch(() => null);
      const fetched = await Promise.all(urls.map(page));
      const pages = fetched.filter((h): h is string => !!h);
      if (!pages.length) throw new ConvexError({ code: "UNREACHABLE", message: `We couldn't open ${host}. Check the address and try again.` });
      // The store's main product: the pasted product page, else the first product the home page links to.
      let productPath = u.pathname.includes("/products/") && fetched[0] ? u.pathname : undefined;
      let productHtml = productPath ? fetched[0] : null;
      if (!productPath) {
        productPath = pages.map(firstProductPath).find(Boolean);
        productHtml = productPath ? await page(`${origin}${productPath}`) : null;
        if (productHtml) pages.push(productHtml);
      }
      result = mergeInspections(pages.map(inspectHtml));
      if (!result.shopify) throw new ConvexError({ code: "NOT_SHOPIFY", message: `${host} doesn't look like a Shopify store. The Inspector reads Shopify stores only.` });
      let teardown: Teardown | null = null;
      if (productPath && productHtml) teardown = await teardownAt(origin, productPath, productHtml, result.currency);
      result = { ...result, teardown, history: await historyLater, domain: await domainLater };
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
      out.push({ _id: r._id, host: r.host, inspectedAt: r.inspectedAt, result: r.result as Inspection, analysis: (r.analysis as StoreAnalysis | undefined) ?? null, storeId: store?._id ?? null, tracked });
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
    const max = watchLimit(user);
    const count = (await ctx.db.query("trackedStores").withIndex("by_user", (q) => q.eq("userId", user._id)).take(max)).length;
    if (count >= max) {
      throw new ConvexError({
        code: "LIMIT",
        message: watchLimitMessage(user),
      });
    }
    await ctx.db.insert("trackedStores", { userId: user._id, storeId: store._id, trackedAt: new Date().toISOString() });
    await ctx.scheduler.runAfter(0, internal.storeSales.checkOne, { storeId: store._id });
    return { storeId: store._id, tracked: true };
  },
});

/** "Analyze this store" (ai.ts analyzeStore): the user's inspection and the store's ads AdSpy has. */
export const forAnalysis = internalQuery({
  args: { token: v.string(), inspectionId: v.id("storeInspections") },
  handler: async (ctx, args) => {
    const user = await userByToken(ctx, args.token);
    const row = await ctx.db.get("storeInspections", args.inspectionId);
    if (!user || !row || (row.userId !== user._id && user.role !== "admin")) return null;
    const ads = await ctx.db.query("ads").withIndex("by_landing_host", (q) => q.eq("landingHost", row.host)).take(40);
    const storeAds: StoreAd[] = ads.map((a) => ({
      headline: a.headline ?? "",
      body: a.bodyText ?? "",
      daysRunning: a.daysRunning ?? 0,
      ...(a.country ? { country: a.country } : {}),
      ...(a.isActive !== undefined ? { isActive: a.isActive } : {}),
    }));
    return { host: row.host, result: row.result as Inspection, ads: storeAds };
  },
});

export const saveAnalysis = internalMutation({
  args: { inspectionId: v.id("storeInspections"), analysis: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch("storeInspections", args.inspectionId, { analysis: args.analysis, analyzedAt: new Date().toISOString() });
  },
});
