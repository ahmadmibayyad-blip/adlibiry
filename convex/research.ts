import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { NICHES } from "./lib/category";
import { productTitleForAd } from "./lib/productMatch";
import { buildDashboard, buildNiches, buildTrends, isHomepageUrl, type AdLite, type ProductLite } from "./lib/research";

// ── Research → Trends and Niche Explorer ────────────────────────────────────
// Rebuilt once a day right after the product pipeline (convex/productPipeline.ts)
// from real ads and products; replaces the old demo rows in the `trends` and
// `niches` tables. Reads page by page from an action, so table size never
// hits a single function's read limit.

const TREND_WINDOW_MS = 12 * 7 * 86_400_000;

export const adsPage = internalQuery({
  args: { since: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("ads")
      .withIndex("by_first_seen", (q) => q.gte("firstSeenAt", args.since))
      .paginate({ numItems: 200, cursor: args.cursor });
    const ads: AdLite[] = page.page.map((a) => ({
      title: productTitleForAd(a),
      niche: a.niche,
      platform: a.platform,
      countries: a.countries?.length ? a.countries : a.country && a.country !== "INTL" ? [a.country] : [],
      firstSeenAt: a.firstSeenAt,
    }));
    return { ads, isDone: page.isDone, cursor: page.continueCursor };
  },
});

export const productsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("products").paginate({ numItems: 250, cursor: args.cursor }); // whole product docs: big pages pass the read limit
    const products: ProductLite[] = page.page.map((p) => ({
      category: p.category,
      aiScore: p.aiScore,
      winnerRank: p.winnerRank,
      linkedAds: p.linkedAds,
      publishedAt: p.publishedAt,
    }));
    return { products, isDone: page.isDone, cursor: page.continueCursor };
  },
});

const trendRow = v.object({
  keyword: v.string(),
  niche: v.string(),
  direction: v.string(),
  risingPercent: v.number(),
  weeklyInterest: v.array(v.number()),
  countryBreakdown: v.array(v.object({ country: v.string(), interest: v.number() })),
  insight: v.string(),
});
const nicheRow = v.object({
  name: v.string(),
  icon: v.string(),
  description: v.string(),
  avgAiScore: v.number(),
  productCount: v.number(),
  trendDirection: v.string(),
  topCountries: v.array(v.string()),
});

const series = v.array(v.object({ day: v.string(), value: v.number() }));
const dashboardStats = v.object({
  adsPerDay: series,
  productsPerDay: series,
  topNiches: v.array(v.object({ niche: v.string(), thisWeek: v.number(), lastWeek: v.number() })),
});

export const save = internalMutation({
  args: { trends: v.array(trendRow), niches: v.array(nicheRow), dashboard: dashboardStats },
  handler: async (ctx, args) => {
    for (const t of await ctx.db.query("trends").collect()) await ctx.db.delete("trends", t._id);
    for (const n of await ctx.db.query("niches").collect()) await ctx.db.delete("niches", n._id);
    // Old demo supplier listings link to a store's homepage, not a product.
    for (const s of await ctx.db.query("supplierListings").collect()) {
      if (isHomepageUrl(s.supplierUrl)) await ctx.db.delete("supplierListings", s._id);
    }
    const updatedAt = new Date().toISOString();
    for (const t of args.trends) await ctx.db.insert("trends", { ...t, updatedAt });
    for (const n of args.niches) await ctx.db.insert("niches", n);
    // Home dashboard charts (convex/dashboard.ts).
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "dashboard")).unique();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data: args.dashboard, updatedAt });
    else await ctx.db.insert("siteStats", { key: "dashboard", data: args.dashboard, updatedAt });
  },
});

async function rebuildResearch(ctx: ActionCtx) {
  const now = Date.now();
  const since = new Date(now - TREND_WINDOW_MS).toISOString();
  const ads: AdLite[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { ads: AdLite[]; isDone: boolean; cursor: string } = await ctx.runQuery(internal.research.adsPage, { since, cursor });
    ads.push(...page.ads);
    if (page.isDone) break;
    cursor = page.cursor;
  }
  const products: ProductLite[] = [];
  cursor = null;
  for (;;) {
    const page: { products: ProductLite[]; isDone: boolean; cursor: string } = await ctx.runQuery(internal.research.productsPage, { cursor });
    products.push(...page.products);
    if (page.isDone) break;
    cursor = page.cursor;
  }
  const trends = buildTrends(ads, now);
  const niches = buildNiches(NICHES, products, ads, now);
  await ctx.runMutation(internal.research.save, { trends, niches, dashboard: buildDashboard(ads, products, now) });
  return { ads: ads.length, products: products.length, trends: trends.length, categories: niches.length };
}

export const rebuild = internalAction({
  args: {},
  handler: async (ctx) => {
    await rebuildResearch(ctx);
  },
});

// Admin → "Rebuild research": the same rebuild now, with what it built or why it failed.
export const rebuildNow = action({
  args: {},
  handler: async (ctx): Promise<{ ads: number; products: number; trends: number; categories: number } | { error: string }> => {
    await ctx.runQuery(internal.hooks.assertAdmin, {});
    try {
      return await rebuildResearch(ctx);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});
