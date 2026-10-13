import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "./helpers";
import { markStatsDirty } from "../stats";
import { productKey } from "./productImport";
import { MAX_MARKET_PRICE_USD } from "../lib/launchCopy";

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

// Undo the last product CSV import. Its products have source "csv_import" and
// the source name typed in the import dialog as their second tag (see
// productImport.ts upsertProductRows). One import is a run of those products
// created close together, ending at a product of another import; products it
// only updated were already there, so they stay.

const SCAN = 400;
// A longer pause between two products of the same name starts an older import.
const IMPORT_GAP_MS = 30 * 60 * 1000;

type ImportedProduct = { source?: string; tags: string[] };
const importName = (p: ImportedProduct) => (p.source === "csv_import" ? (p.tags[1] ?? "") : null);

export const lastProductImport = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const recent = await ctx.db.query("products").order("desc").take(2000);
    const newest = recent.find((p) => importName(p) !== null);
    if (!newest) return null;
    return { name: importName(newest)!, at: newest._creationTime };
  },
});

// Walks products newest first from `before` and deletes this import's ones;
// call again with the returned `before` and `last` until done.
export const removeProductImport = mutation({
  args: { name: v.string(), before: v.number(), last: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const page = await ctx.db
      .query("products")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", args.before))
      .order("desc")
      .take(SCAN);
    let last = args.last;
    let deleted = 0;
    let done = page.length < SCAN;
    for (const p of page) {
      const name = importName(p);
      if (name === null) continue;
      // A product of another import, or a long pause, means the older imports begin.
      if (name !== args.name || (last !== undefined && last - p._creationTime > IMPORT_GAP_MS)) {
        done = true;
        break;
      }
      last = p._creationTime;
      const link = await ctx.db
        .query("syncLinks")
        .withIndex("by_kind_external", (q) => q.eq("kind", "product").eq("externalId", productKey(p.storeUrl ?? "", p.title, p.imageUrl)))
        .unique();
      if (link && link.docId === p._id) await ctx.db.delete("syncLinks", link._id);
      await ctx.db.delete("products", p._id);
      deleted += 1;
    }
    if (deleted) await markStatsDirty(ctx);
    const before = page.length ? page[page.length - 1]._creationTime : args.before;
    return { deleted, before, last, done };
  },
});

// Prices in a local currency read as dollars (a Rp 78,495 hair oil stored as $78,495, before
// src/lib/productCsv.ts converted currencies): no product a one-product store sells costs that.
// Their price, GMV and the money estimates built on them are removed, so they show as unknown
// instead of ranking at the top; importing the file again fills them in correctly.
export function hasImpossiblePrice(p: { price?: number; cost?: number }): boolean {
  return (p.price ?? 0) > MAX_MARKET_PRICE_USD || (p.cost ?? 0) > MAX_MARKET_PRICE_USD;
}

// Walks every product one page per call; call again with the returned cursor until isDone.
export const clearImpossiblePrices = mutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const page = await ctx.db.query("products").paginate({ cursor: args.cursor, numItems: BATCH });
    let fixed = 0;
    for (const p of page.page) {
      if (!hasImpossiblePrice(p)) continue;
      const basis = p.estBasis ? { ...(p.estBasis.impressions ? { impressions: p.estBasis.impressions } : {}) } : undefined;
      await ctx.db.patch("products", p._id, {
        price: undefined,
        priceSource: undefined,
        ...((p.cost ?? 0) > MAX_MARKET_PRICE_USD ? { cost: undefined } : {}),
        linkedGmv: undefined,
        estRevenue: undefined,
        estAdSpend: undefined,
        ...(basis ? { estBasis: basis } : {}),
      });
      fixed += 1;
    }
    if (fixed) await markStatsDirty(ctx);
    return { fixed, cursor: page.continueCursor, isDone: page.isDone };
  },
});
