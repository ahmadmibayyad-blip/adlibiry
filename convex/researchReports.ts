import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";
import { marginMath, type ResearchCall, type ResearchEvidence } from "./lib/researchReport";
import type { Id } from "./_generated/dataModel";
import { countAngles, verdict } from "./lib/verdict";

// Saved AI research verdicts (ai.ts researchProduct), one per user and product,
// and the AdSpy evidence the AI gets (lib/researchReport.ts).

const PRICE_SOURCE: Record<string, string> = {
  exact: "the store's own price",
  landing_page: "read from the store's page",
  estimated_market: "a category benchmark, not this product's real price",
};

export const latest = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) return null;
    return ctx.db
      .query("researchReports")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id).eq("productId", args.productId))
      .order("desc")
      .first();
  },
});

/** Everything AdSpy knows about the product that bears on "should I test it?", for the signed-in user's market. */
export const evidence = internalQuery({
  args: { productId: v.id("products"), token: v.string() },
  handler: async (ctx, args): Promise<{ userId: string; evidence: ResearchEvidence; supplierUrl?: string } | null> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    const p = await ctx.db.get("products", args.productId);
    if (!user || !p) return null;
    const ads = await ctx.db.query("ads").withIndex("by_product", (q) => q.eq("productId", p._id)).take(200);
    const target = user.targetCountry ?? undefined;
    const local = target ? p.saturationByCountry?.find((c) => c.country === target) : undefined;
    const best = p.supplierMatches?.[0];
    const samples = [...ads]
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 4)
      .map((a) => `${a.headline} — ${a.bodyText}`.replace(/\s+/g, " ").slice(0, 280));
    const quick = verdict({ ...p, angleCount: countAngles(ads.map((a) => a.headline)), targetCountry: target });
    return {
      userId: user._id,
      ...(best?.url ? { supplierUrl: best.url } : {}),
      evidence: {
        title: p.title,
        category: p.category,
        description: p.description,
        ...(target ? { targetCountry: target } : {}),
        ...(p.price ? { retailPrice: p.price } : {}),
        ...(p.priceSource && PRICE_SOURCE[p.priceSource] ? { retailPriceSource: PRICE_SOURCE[p.priceSource] } : {}),
        ...(p.cost ? { cost: p.cost } : {}),
        ...(p.costSource ? { costSource: p.costSource } : {}),
        margin: marginMath(p.price, p.cost),
        ...(best ? { supplier: { title: best.title, price: best.price, url: best.url, ...(best.orders ? { orders: best.orders } : {}), ...(best.rating ? { rating: best.rating } : {}) } } : {}),
        ads: {
          count: ads.length,
          advertisers: new Set(ads.map((a) => a.advertiserName)).size,
          longestDays: ads.reduce((m, a) => Math.max(m, a.daysRunning), 0),
          platforms: [...new Set(ads.map((a) => a.platform))],
          countries: [...new Set(ads.flatMap((a) => a.countries ?? [a.country]))],
          samples,
        },
        ...(p.estRevenue ? { estRevenue: p.estRevenue } : {}),
        ...(p.estBasis?.revenue ? { revenueBasis: p.estBasis.revenue } : {}),
        ...(p.trend ? { trend: p.trend } : {}),
        ...(p.momentum14 !== undefined ? { momentum14: p.momentum14 } : {}),
        ...(p.saturation ? { saturation: p.saturation } : {}),
        ...(local ? { localCompetition: local } : {}),
        quickCheck: quick.line,
      },
    };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), productId: v.id("products"), report: v.any(), margin: v.any(), reviews: v.optional(v.any()) },
  handler: async (ctx, args) => {
    await ctx.db.insert("researchReports", { ...args, createdAt: new Date().toISOString() });
  },
});

/** The latest research call per product for the signed-in user, for the badges in product lists. */
export const myCalls = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) return [];
    const rows = await ctx.db.query("researchReports").withIndex("by_user_product", (q) => q.eq("userId", user._id)).take(2000);
    const latest = new Map<string, { productId: Id<"products">; call: ResearchCall; at: string }>();
    for (const r of rows) {
      const prev = latest.get(r.productId);
      if (!prev || r.createdAt > prev.at) latest.set(r.productId, { productId: r.productId, call: (r.report as { call: ResearchCall }).call, at: r.createdAt });
    }
    return [...latest.values()].map(({ productId, call }) => ({ productId, call }));
  },
});
