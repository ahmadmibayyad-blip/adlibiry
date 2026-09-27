import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";

// V8 runtime — persists and reads real saturation-check snapshots. Kept out of
// the "use node" analyze.ts file since internalMutation can't live there.

export const recordCheck = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    productTitle: v.string(),
    niche: v.string(),
    country: v.string(),
    saturationScore: v.number(),
    demandScore: v.number(),
    opportunityScore: v.number(),
    confidenceScore: v.number(),
    signals: v.object({
      localAdvertiserCount: v.number(),
      localActiveAds: v.number(),
      recentLocalAdvertisers30d: v.number(),
      globalAdvertiserCount: v.number(),
      localStoreCount: v.number(),
      localStoreActiveAds: v.number(),
      supplierSellerCount: v.optional(v.number()),
      trendInterest: v.optional(v.number()),
      trendDirection: v.optional(v.string()),
      trendRisingPercent: v.optional(v.number()),
      sourcesAnalyzed: v.array(v.string()),
      sourcesUnavailable: v.array(v.string()),
    }),
    aiSummary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("saturationChecks", {
      ...args,
      createdAt: new Date().toISOString(),
    });
  },
});

// Saturation trend for a niche+country: how the computed score has moved over
// the real checks we've actually run, oldest to newest.
export const getHistory = query({
  args: { niche: v.string(), country: v.string() },
  handler: async (ctx, args) => {
    const checks = await ctx.db
      .query("saturationChecks")
      .withIndex("by_niche_and_country", (q) => q.eq("niche", args.niche).eq("country", args.country))
      .order("desc")
      .take(20);
    return checks.reverse().map((c) => ({
      _id: c._id,
      saturationScore: c.saturationScore,
      demandScore: c.demandScore,
      opportunityScore: c.opportunityScore,
      createdAt: c.createdAt,
    }));
  },
});
