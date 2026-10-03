import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import type { Doc } from "./_generated/dataModel";
import { adNumbers } from "./productPipeline";

// ── Chart data for the product and ad detail pages ──────────────────────────
// Daily rows come from convex/productPipeline.ts (kept 90 days).

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const range = v.union(v.literal(7), v.literal(30), v.literal(90));

export const productHistory = query({
  args: { productId: v.id("products"), days: range },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await ctx.db
      .query("dailySnapshots")
      .withIndex("by_entity_day", (q) => q.eq("kind", "product").eq("entityId", args.productId).gte("day", since(args.days)))
      .collect();
  },
});

export const adHistory = query({
  args: { adId: v.id("ads"), days: range },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await ctx.db
      .query("dailySnapshots")
      .withIndex("by_entity_day", (q) => q.eq("kind", "ad").eq("entityId", args.adId).gte("day", since(args.days)))
      .collect();
  },
});

// The ads linked to a product, with the numbers the detail page shows.
export const productAds = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const ads = await ctx.db
      .query("ads")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .take(100);
    return ads
      .map((a) => ({
        _id: a._id,
        headline: a.headline,
        advertiserName: a.advertiserName,
        platform: a.platform,
        country: a.country,
        countries: a.countries,
        creativeUrl: a.creativeUrl,
        mediaType: a.mediaType,
        daysRunning: a.daysRunning,
        aiScore: a.aiScore,
        ...adNumbers(a),
      }))
      .sort((a, b) => b.views - a.views);
  },
});

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Share of ads this ad beats (0–100).
const percentile = (xs: number[], x: number) => (xs.length ? Math.round((xs.filter((y) => y < x).length / xs.length) * 100) : 0);

const engagement = (a: Doc<"ads">) => {
  const n = adNumbers(a);
  return n.views > 0 ? (n.likes + n.comments) / n.views : 0;
};

// How one ad compares with up to 500 recent ads in the same niche.
export const adNicheComparison = query({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const ad = await ctx.db.get("ads", args.adId);
    if (!ad) return null;
    const peers = await ctx.db
      .query("ads")
      .withIndex("by_niche", (q) => q.eq("niche", ad.niche))
      .order("desc")
      .take(500);
    const metric = (get: (a: Doc<"ads">) => number) => {
      const all = peers.map(get);
      const max = Math.max(...all, get(ad), 0);
      return { value: get(ad), median: median(all), max, percentile: percentile(all, get(ad)) };
    };
    return {
      niche: ad.niche,
      peers: peers.length,
      views: metric((a) => adNumbers(a).views),
      engagement: metric(engagement),
      daysRunning: metric((a) => a.daysRunning),
    };
  },
});
