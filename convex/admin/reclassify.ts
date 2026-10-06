import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAdmin } from "./helpers";
import { classifyNiche } from "../lib/category";
import { markStatsDirty } from "../stats";

// One-off (admin button) re-check of the niche on rows that importers filed
// under the *searched* niche instead of what the ad/product actually sells.
// Only auto-imported rows are touched — niches an admin picked by hand
// (curated, extension approvals, CSV imports) are left alone. A row keeps its
// current niche when the classifier isn't confident.

const AUTO_AD_SOURCES = new Set(["adlibrary_api", "apify", "nexscope", "winninghunter"]);
const AUTO_PRODUCT_SOURCES = new Set(["adlibrary_api", "nexscope_api", "tiktok_shop", "shopify", "winninghunter"]);
const PAGE = 200;

type Status = { running: boolean; adsChanged: number; productsChanged: number; startedAt: string; finishedAt?: string };

async function saveStatus(ctx: Parameters<typeof markStatsDirty>[0], status: Status) {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "reclassify")).unique();
  const now = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc._id, { data: status, updatedAt: now });
  else await ctx.db.insert("siteStats", { key: "reclassify", data: status, updatedAt: now });
}

export const reclassifyAdsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), status: v.any() },
  handler: async (ctx, { cursor, status }) => {
    const s = status as Status;
    const res = await ctx.db.query("ads").paginate({ numItems: PAGE, cursor });
    for (const a of res.page) {
      if (!AUTO_AD_SOURCES.has(a.source)) continue;
      const niche = classifyNiche({ title: a.headline, body: a.bodyText, url: a.landingPageUrl, advertiser: a.advertiserName }, a.niche);
      if (niche !== a.niche) {
        await ctx.db.patch("ads", a._id, { niche });
        s.adsChanged++;
      }
    }
    await saveStatus(ctx, s);
    if (!res.isDone) await ctx.scheduler.runAfter(0, internal.admin.reclassify.reclassifyAdsPage, { cursor: res.continueCursor, status: s });
    else await ctx.scheduler.runAfter(0, internal.admin.reclassify.reclassifyProductsPage, { cursor: null, status: s });
    return null;
  },
});

export const reclassifyProductsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), status: v.any() },
  handler: async (ctx, { cursor, status }) => {
    const s = status as Status;
    const res = await ctx.db.query("products").paginate({ numItems: PAGE, cursor });
    for (const p of res.page) {
      if (!p.source || !AUTO_PRODUCT_SOURCES.has(p.source)) continue;
      const category = classifyNiche({ title: p.title, body: p.description, url: p.storeUrl ?? p.supplierUrl }, p.category);
      if (category !== p.category) {
        const tags = [category, ...p.tags.filter((t) => t !== p.category && t !== category)];
        await ctx.db.patch("products", p._id, { category, tags });
        s.productsChanged++;
      }
    }
    if (!res.isDone) {
      await saveStatus(ctx, s);
      await ctx.scheduler.runAfter(0, internal.admin.reclassify.reclassifyProductsPage, { cursor: res.continueCursor, status: s });
    } else {
      await saveStatus(ctx, { ...s, running: false, finishedAt: new Date().toISOString() });
      await markStatsDirty(ctx); // niche filter counts change
    }
    return null;
  },
});

export const start = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const current = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "reclassify")).unique();
    const prev = current?.data as Status | undefined;
    // A run that died mid-way would block forever; allow a restart after an hour.
    if (prev?.running && Date.now() - Date.parse(prev.startedAt) < 3_600_000) return { alreadyRunning: true };
    const status: Status = { running: true, adsChanged: 0, productsChanged: 0, startedAt: new Date().toISOString() };
    await saveStatus(ctx, status);
    await ctx.scheduler.runAfter(0, internal.admin.reclassify.reclassifyAdsPage, { cursor: null, status });
    return { alreadyRunning: false };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "reclassify")).unique();
    return (doc?.data as Status | undefined) ?? null;
  },
});
