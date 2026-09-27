import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { platformLabel } from "./client";

// Winning Products: derives one real "winning product" per niche from the
// same AdLibrary.com data already fetched for Ad Spy (no extra API credits).
// Picks the single top-heat ad per niche (already sorted "-heat_degree" by
// the search request) and turns its real ad data into a product entry.
// Never fabricates price or cost — AdLibrary provides neither, so both stay
// unset and the UI hides them for these products.

function formatImpressions(count: number | undefined): string {
  if (!count) return "Live";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

// Coarse trend label derived only from AdLibrary's own "heat" signal — never
// fabricated. Heat is AdLibrary's own 0-1000 measure of current ad momentum.
function trendFromHeat(heat: number): string {
  if (heat >= 900) return "Rising";
  if (heat >= 700) return "Stable";
  return "Declining";
}

function scoreFromHeat(heat: number, daysCount: number, impression: number): number {
  const heatComponent = Math.min(heat, 1000) / 10;
  const longevityComponent = (Math.min(daysCount, 60) / 60) * 100 * 0.3;
  const impressionComponent = (Math.min(impression, 500000) / 500000) * 100 * 0.2;
  const score = heatComponent * 0.5 + longevityComponent + impressionComponent;
  return Math.max(1, Math.min(100, Math.round(score)));
}

export const upsertProductFromTopAd = internalMutation({
  args: {
    niche: v.string(),
    adKey: v.string(),
    advertiserName: v.string(),
    platform: v.string(),
    headline: v.string(),
    bodyText: v.string(),
    imageUrl: v.string(),
    landingPageUrl: v.string(),
    heat: v.number(),
    daysCount: v.number(),
    impression: v.number(),
  },
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const platform = platformLabel(args.platform);
    const description = `Spotted running live on ${platform} by ${args.advertiserName}. ${args.bodyText}`.trim();

    const productDoc = {
      title: args.headline,
      description: description.slice(0, 500),
      imageUrl: args.imageUrl,
      category: args.niche,
      tags: [args.niche, platform, "live ad"],
      aiScore: scoreFromHeat(args.heat, args.daysCount, args.impression),
      saturation: "Unknown",
      trend: trendFromHeat(args.heat),
      supplierUrl: args.landingPageUrl,
      adExamples: [
        {
          platform,
          impressions: formatImpressions(args.impression),
          imageUrl: args.imageUrl,
        },
      ],
      isWinnerOfDay: true,
      source: "adlibrary_api",
    };

    const existingLink = await ctx.db
      .query("productSyncedItems")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.adKey))
      .unique();

    if (existingLink) {
      await ctx.db.patch("products", existingLink.productId, productDoc);
      await ctx.db.patch("productSyncedItems", existingLink._id, { lastSyncedAt: new Date().toISOString() });
      return "updated";
    }

    const productId = await ctx.db.insert("products", {
      ...productDoc,
      publishedAt: new Date().toISOString(),
    });
    await ctx.db.insert("productSyncedItems", {
      externalId: args.adKey,
      productId,
      lastSyncedAt: new Date().toISOString(),
    });
    return "created";
  },
});
