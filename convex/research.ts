import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { NICHES } from "./lib/category";
import { productTitleForAd } from "./lib/productMatch";
import { buildNiches, buildTrends, isHomepageUrl, type AdLite, type ProductLite } from "./lib/research";

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
      .paginate({ numItems: 400, cursor: args.cursor });
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
    const page = await ctx.db.query("products").paginate({ numItems: 1000, cursor: args.cursor });
    const products: ProductLite[] = page.page.map((p) => ({
      category: p.category,
      aiScore: p.aiScore,
      winnerRank: p.winnerRank,
      linkedAds: p.linkedAds,
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

export const save = internalMutation({
  args: { trends: v.array(trendRow), niches: v.array(nicheRow) },
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
  },
});

export const rebuild = internalAction({
  args: {},
  handler: async (ctx) => {
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
    await ctx.runMutation(internal.research.save, {
      trends: buildTrends(ads, now),
      niches: buildNiches(NICHES, products, ads, now),
    });
  },
});
