import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "./helpers";
import { markStatsDirty } from "../stats";

// Undo the last ad CSV import. Every ad from one import shares the same
// firstSeenAt (the import time, see src/lib/adCsv.ts buildAdRows), so the
// newest firstSeenAt among source "csv_import" ads is that whole file.

const BATCH = 200;

export const lastAdImport = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Index on (source, firstSeenAt): jumps to the newest CSV import instead
    // of walking every ad until one turns up.
    const newest = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import"))
      .order("desc")
      .first();
    if (!newest) return null;
    const at = newest.firstSeenAt;
    const rows = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import").eq("firstSeenAt", at))
      .take(5000);
    return { at, count: rows.length };
  },
});

// Deletes up to BATCH ads of that import per call; call again while remaining > 0.
export const removeAdImport = mutation({
  args: { at: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import").eq("firstSeenAt", args.at))
      .take(5000);
    const now = rows.slice(0, BATCH);
    for (const ad of now) {
      if (ad.externalKey) {
        const link = await ctx.db
          .query("syncLinks")
          .withIndex("by_kind_external", (q) => q.eq("kind", "ad").eq("externalId", ad.externalKey!))
          .unique();
        if (link) await ctx.db.delete("syncLinks", link._id);
      }
      await ctx.db.delete("ads", ad._id);
    }
    if (now.length) await markStatsDirty(ctx);
    return { deleted: now.length, remaining: rows.length - now.length };
  },
});

// Product listings imported as ads: rows from a product-finder export
// (Kalodata, FastMoss, TikTok Shop) uploaded through the ads CSV import. The
// import kept their columns as "Name: value · …" ad text, and they have no
// likes or views, so they show as empty ad cards.
const PRODUCT_LISTING_TEXT = /(^|· )(Items Sold \(|GMV \(Last|Total GMV:|Product Price:|Product Rating:)/;

type CleanupAd = { source?: string; bodyText: string; likes: number; impressions?: number; comments?: number; shares?: number; daysRunning: number };

export function isProductListingAd(ad: CleanupAd): boolean {
  return ad.source === "csv_import" && ad.likes === 0 && !ad.impressions && !ad.comments && PRODUCT_LISTING_TEXT.test(ad.bodyText);
}

// CSV ads with no numbers at all: no likes, views, comments, shares or days
// running (files without those columns). They show as all-"—" cards.
export function isEmptyCsvAd(ad: CleanupAd): boolean {
  return ad.source === "csv_import" && ad.likes === 0 && !ad.impressions && !ad.comments && !ad.shares && ad.daysRunning === 0;
}

// Walks the CSV-imported ads one page per call and deletes the product
// listings and the ads with no numbers; call again with the returned cursor
// until isDone.
export const removeProductListingAds = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const page = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import"))
      .paginate({ cursor: args.cursor, numItems: BATCH });
    let deleted = 0;
    for (const ad of page.page) {
      if (!isProductListingAd(ad) && !isEmptyCsvAd(ad)) continue;
      if (ad.externalKey) {
        const link = await ctx.db
          .query("syncLinks")
          .withIndex("by_kind_external", (q) => q.eq("kind", "ad").eq("externalId", ad.externalKey!))
          .unique();
        if (link) await ctx.db.delete("syncLinks", link._id);
      }
      await ctx.db.delete("ads", ad._id);
      deleted += 1;
    }
    if (deleted) await markStatsDirty(ctx);
    return { deleted, cursor: page.continueCursor, isDone: page.isDone };
  },
});
