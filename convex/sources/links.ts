import { markStatsDirty } from "../stats";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { richAdFields, defined } from "../lib/adFields";

export const adFields = {
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
  ...richAdFields,
};

const REQUIRED_TEXT_DEFAULTS = { headline: "", bodyText: "", creativeUrl: "", landingPageUrl: "", spendEstimate: "Unknown", views: "0" };

// Insert or update one ad coming from Nexscope or Apify. On repeat sightings
// metrics (likes, views, days running, score) refresh; the original
// first-seen date and any enriched targeting are kept.
const adArgs = v.object(adFields);
export type ExternalAd = Infer<typeof adArgs>;

// `refreshFirstSeen` lets a re-import overwrite the stored first-seen date
// (admin CSV uploads, whose earlier versions back-dated it).
export async function upsertAd(
  ctx: MutationCtx,
  args: ExternalAd,
  opts: { refreshFirstSeen?: boolean } = {},
): Promise<"created" | "updated"> {
    const { externalId, source, targeting, ...rest } = args;
    const fields = defined(rest) as typeof rest;
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
          firstSeenAt: opts.refreshFirstSeen ? fields.firstSeenAt : existing.firstSeenAt,
          ...(targeting ? { targeting } : {}),
          source,
        });
        await ctx.db.patch("syncLinks", link._id, { lastSyncedAt: now });
        return "updated";
      }
      await ctx.db.delete("syncLinks", link._id); // ad was deleted by an admin — recreate
    }
    await markStatsDirty(ctx);
    const adId = await ctx.db.insert("ads", {
      // defined() drops empty strings; the ads table still needs these.
      ...REQUIRED_TEXT_DEFAULTS,
      ...fields,
      externalKey: externalId,
      targeting: targeting ?? { ageRange: "Unknown", gender: "All", interests: [] },
      source,
    });
    await ctx.db.insert("syncLinks", { kind: "ad", externalId, docId: adId, source, lastSyncedAt: now });
    return "created";
  }

export const upsertExternalAd = internalMutation({
  args: adFields,
  handler: async (ctx, args): Promise<"created" | "updated"> => upsertAd(ctx, args),
});

// Same as upsertExternalAd for a batch, so big imports make one call per 50 ads
// instead of one per ad. A bad ad is reported, not fatal to its batch.
export const upsertExternalAds = internalMutation({
  args: { ads: v.array(adArgs) },
  handler: async (ctx, args): Promise<{ created: number; updated: number; errors: string[] }> => {
    const out = { created: 0, updated: 0, errors: [] as string[] };
    for (const ad of args.ads) {
      try {
        if ((await upsertAd(ctx, ad)) === "created") out.created += 1;
        else out.updated += 1;
      } catch (e) {
        out.errors.push(`save ${ad.externalId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
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
