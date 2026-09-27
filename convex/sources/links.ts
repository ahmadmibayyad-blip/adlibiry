import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const adFields = {
  externalId: v.string(),
  source: v.string(),
  advertiserName: v.string(),
  platform: v.string(),
  country: v.string(),
  niche: v.string(),
  headline: v.string(),
  bodyText: v.string(),
  creativeUrl: v.string(),
  landingPageUrl: v.string(),
  spendEstimate: v.string(),
  likes: v.number(),
  views: v.string(),
  daysRunning: v.number(),
  aiScore: v.number(),
  firstSeenAt: v.string(),
  targeting: v.optional(v.object({ ageRange: v.string(), gender: v.string(), interests: v.array(v.string()) })),
};

// Insert or update one ad coming from Nexscope or Apify. On repeat sightings
// metrics (likes, views, days running, score) refresh; the original
// first-seen date and any enriched targeting are kept.
export const upsertExternalAd = internalMutation({
  args: adFields,
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const { externalId, source, targeting, ...fields } = args;
    const now = new Date().toISOString();
    const link = await ctx.db
      .query("syncLinks")
      .withIndex("by_kind_external", (q) => q.eq("kind", "ad").eq("externalId", externalId))
      .unique();
    if (link) {
      const adId = link.docId as Id<"ads">;
      const existing = await ctx.db.get("ads", adId);
      if (existing) {
        await ctx.db.patch("ads", adId, {
          ...fields,
          firstSeenAt: existing.firstSeenAt,
          ...(targeting ? { targeting } : {}),
          source,
        });
        await ctx.db.patch("syncLinks", link._id, { lastSyncedAt: now });
        return "updated";
      }
      await ctx.db.delete("syncLinks", link._id); // ad was deleted by an admin — recreate
    }
    const adId = await ctx.db.insert("ads", {
      ...fields,
      targeting: targeting ?? { ageRange: "Unknown", gender: "All", interests: [] },
      source,
    });
    await ctx.db.insert("syncLinks", { kind: "ad", externalId, docId: adId, source, lastSyncedAt: now });
    return "created";
  },
});

export const upsertExternalStore = internalMutation({
  args: {
    externalId: v.string(),
    source: v.string(),
    name: v.string(),
    url: v.string(),
    logoUrl: v.string(),
    niche: v.string(),
    country: v.string(),
    estimatedRevenueRange: v.string(),
    trafficRange: v.string(),
    activeAdsCount: v.number(),
    isHighTraffic: v.boolean(),
  },
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const { externalId, source, ...fields } = args;
    const now = new Date().toISOString();
    const link = await ctx.db
      .query("syncLinks")
      .withIndex("by_kind_external", (q) => q.eq("kind", "store").eq("externalId", externalId))
      .unique();
    if (link) {
      const storeId = link.docId as Id<"stores">;
      const existing = await ctx.db.get("stores", storeId);
      if (existing) {
        await ctx.db.patch("stores", storeId, fields);
        await ctx.db.patch("syncLinks", link._id, { lastSyncedAt: now });
        return "updated";
      }
      await ctx.db.delete("syncLinks", link._id);
    }
    const storeId = await ctx.db.insert("stores", {
      ...fields,
      platform: "Shopify",
      bestSellers: [],
      spottedAt: now,
    });
    await ctx.db.insert("syncLinks", { kind: "store", externalId, docId: storeId, source, lastSyncedAt: now });
    return "created";
  },
});
