import { markStatsDirty } from "../stats";
import { v, ConvexError } from "convex/values";
import { internalAction, action, internalMutation, internalQuery } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { retireStaleWinners, winnerSlot } from "../lib/winners";
import { classifyNiche } from "../lib/category";
import { findPayload, nestedError } from "../lib/nexscopeReply";
import {
  NEXSCOPE_AMAZON_DISCOVERY_URL,
  NICHE_DISCOVERY_KEYWORDS,
  scoreFromAmazonSignals,
  trendFromClickGrowth,
  deriveCostFromMargin,
  type NexscopeAmazonProduct,
  type NexscopeAmazonDiscoveryResponse,
} from "./client";
import { fromShopify, fromTikTokShop, nexscopeSkillUrl, normalizeShopify, storeFromShopify, type TikTokShopProduct } from "./marketplaces";

// Winning Products: discovers real Amazon bestseller candidates per niche
// from Nexscope.ai — each one a real, single ASIN with its own real title,
// image, and price (unlike the AdLibrary-derived products, which have no
// price and get a category-average benchmark instead). Deduped by ASIN so
// re-running updates existing rows instead of creating duplicates.
// Each run searches the next keyword for every niche (NICHE_DISCOVERY_KEYWORDS)
// and saves every usable listing it gets back (up to 10 per niche), so the
// catalog grows; the top PRODUCTS_PER_NICHE are that niche's daily picks.

type SourceCount = { created: number; updated: number };
type DiscoveryResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  bySource?: Record<string, SourceCount>; // "Amazon" | "TikTok Shop" | "Shopify"
  stores?: number; // new stores added to the Stores tracker
};

// POST one Nexscope skill; returns its product list or an error message.
async function runSkill(apiKey: string, skill: string, body: unknown): Promise<{ products: unknown[] } | { error: string }> {
  const response = await fetch(nexscopeSkillUrl(skill), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { error: `Nexscope API error ${response.status} — ${(await response.text()).slice(0, 200)}` };
  const data: unknown = await response.json();
  const providerError = nestedError(data);
  if (providerError) return { error: `Nexscope returned error — ${providerError}` };
  const found = findPayload(data, "products");
  return { products: Array.isArray(found?.products) ? found.products : [] };
}

const PRODUCTS_PER_NICHE = 2;

export const discoverProducts = internalAction({
  args: {},
  handler: async (ctx): Promise<DiscoveryResult> => {
    const apiKey = process.env.NEXSCOPE_API_KEY;
    if (!apiKey) {
      return { created: 0, updated: 0, skipped: 0, errors: ["NEXSCOPE_API_KEY secret is not set. Add it in the Secrets tab."] };
    }

    const result: DiscoveryResult = { created: 0, updated: 0, skipped: 0, errors: [], bySource: {} };
    const count = (source: string, outcome: "created" | "updated") => {
      const c = (result.bySource![source] ??= { created: 0, updated: 0 });
      c[outcome] += 1;
      result[outcome] += 1;
    };
    const { run, storesBackfilled } = await ctx.runMutation(internal.nexscope.productDiscovery.nextRun, {});

    for (const [niche, keywords] of Object.entries(NICHE_DISCOVERY_KEYWORDS)) {
      const keyword = keywords[run % keywords.length];
      try {
        const response = await fetch(NEXSCOPE_AMAZON_DISCOVERY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keyword,
            countryCode: "US",
            sortField: "purchasedClicksT360",
            sortType: "desc",
            page: 1,
            pageSize: 10,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          result.errors.push(`${niche}: Nexscope API error ${response.status} — ${text.slice(0, 200)}`);
          continue;
        }

        const data: NexscopeAmazonDiscoveryResponse = await response.json();
        // Accept the documented direct payload ({ products }) and the
        // enveloped one ({ code, msg, data: { products } }).
        const providerError = nestedError(data);
        if (providerError) {
          result.errors.push(`${niche}: Nexscope returned error — ${providerError}`);
          continue;
        }
        const found = findPayload(data, "products");
        const products = (Array.isArray(found?.products) ? found.products : []) as NexscopeAmazonProduct[];

        const candidates = products.filter(
          (p): p is NexscopeAmazonProduct & { asin: string; title: string; price: number; imageUrl: string } =>
            !!p.asin && !!p.title && typeof p.price === "number" && p.price > 0 && !!p.imageUrl
        );

        if (candidates.length === 0) {
          result.errors.push(`${niche}: no usable Amazon listings found for "${keyword}"`);
          continue;
        }

        result.skipped += products.length - candidates.length;
        const keepIds: Id<"products">[] = [];
        for (const [i, product] of candidates.entries()) {
          const price = Math.round(product.price * 100) / 100;
          const outcome = await ctx.runMutation(internal.nexscope.productDiscovery.upsertAmazonProduct, {
            niche,
            asin: product.asin,
            title: product.title,
            price,
            cost: deriveCostFromMargin(price, product.grossProfitMargin),
            imageUrl: product.imageUrl,
            supplierUrl: product.asinUrl || `https://www.amazon.com/dp/${product.asin}`,
            aiScore: scoreFromAmazonSignals(product),
            trend: trendFromClickGrowth(product.clickCountGrowthT30),
            reviewCount: product.ratings,
            isPick: i < PRODUCTS_PER_NICHE,
          });
          if (i < PRODUCTS_PER_NICHE) keepIds.push(outcome.productId);
          count("Amazon", outcome.outcome);
        }
        // Today's picks are this niche's Nexscope winners; earlier picks retire.
        await ctx.runMutation(internal.nexscope.productDiscovery.retireOldWinners, { niche, keepIds });
      } catch (error) {
        result.errors.push(`${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // TikTok Shop: the top sellers across all categories (one page per run,
    // a different page each run), from two days ago so the day is complete.
    try {
      const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      const reply = await runSkill(apiKey, "tiktok-top-selling-products", {
        region: "US",
        dateInfo: { type: "day", value: day },
        orderby: { field: "units_sold", order: "desc" },
        page: (run % 5) + 1,
        pageSize: 10,
      });
      if ("error" in reply) result.errors.push(`TikTok Shop: ${reply.error}`);
      else {
        for (const raw of reply.products) {
          const d = fromTikTokShop(raw as TikTokShopProduct);
          if (!d) {
            result.skipped += 1;
            continue;
          }
          const outcome = await ctx.runMutation(internal.nexscope.productDiscovery.upsertDiscovered, { ...d, source: "tiktok_shop" });
          count("TikTok Shop", outcome.outcome);
        }
        if (!reply.products.length) result.errors.push("TikTok Shop: no products in the reply");
        else if (!result.bySource!["TikTok Shop"]) {
          const first = reply.products[0] as Record<string, unknown>;
          result.errors.push(`TikTok Shop: ${reply.products.length} products skipped. Fields sent: ${Object.keys(first ?? {}).slice(0, 25).join(", ")}`);
        }
      }
    } catch (error) {
      result.errors.push(`TikTok Shop: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // One time: Shopify products saved before stores were tracked get their store.
    if (!storesBackfilled) {
      let cursor: string | null = null;
      for (;;) {
        const page: { items: Doc<"products">[]; isDone: boolean; cursor: string } = await ctx.runQuery(
          internal.nexscope.productDiscovery.shopifyProductsPage,
          { cursor },
        );
        for (const p of page.items) {
          const store = storeFromShopify({}, p);
          if (store) await ctx.runMutation(internal.nexscope.productDiscovery.upsertProductStore, store);
        }
        if (page.isDone) break;
        cursor = page.cursor;
      }
      await ctx.runMutation(internal.nexscope.productDiscovery.markStoresBackfilled, {});
    }

    // Shopify: store products for the same rotating keyword per niche, only
    // ones running Facebook ads, best weekly sales first.
    for (const [niche, keywords] of Object.entries(NICHE_DISCOVERY_KEYWORDS)) {
      const keyword = keywords[run % keywords.length];
      try {
        const reply = await runSkill(apiKey, "shopify-product-query", { searchKey: keyword, keyword, facebookAd: 1, showDeleted: 0, page: 1, pageSize: 10 });
        if ("error" in reply) {
          result.errors.push(`Shopify ${niche}: ${reply.error}`);
          continue;
        }
        let saved = 0;
        for (const raw of reply.products) {
          const p = normalizeShopify(raw as Record<string, unknown>);
          const d = fromShopify(p, niche);
          if (!d) {
            result.skipped += 1;
            continue;
          }
          saved += 1;
          const outcome = await ctx.runMutation(internal.nexscope.productDiscovery.upsertDiscovered, { ...d, source: "shopify" });
          count("Shopify", outcome.outcome);
          // …and its store goes to the Stores tracker, with this product as a best-seller.
          const store = storeFromShopify(p, d);
          if (store) {
            const s = await ctx.runMutation(internal.nexscope.productDiscovery.upsertProductStore, store);
            result.stores = (result.stores ?? 0) + (s === "created" ? 1 : 0);
          }
        }
        // Say what came back when nothing was usable, so a changed reply shape is visible.
        if (!saved && result.errors.filter((e) => e.startsWith("Shopify")).length < 2) {
          const first = reply.products[0] as Record<string, unknown> | undefined;
          result.errors.push(
            reply.products.length
              ? `Shopify ${niche}: ${reply.products.length} products skipped (no id, title or link). Fields sent: ${Object.keys(first ?? {}).slice(0, 25).join(", ")}`
              : `Shopify ${niche}: no products for "${keyword}"`,
          );
        }
      } catch (error) {
        result.errors.push(`Shopify ${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return result;
  },
});

// Admin-triggered manual product discovery.
export const discoverProductsNow = action({
  args: {},
  handler: async (ctx): Promise<DiscoveryResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return await ctx.runAction(internal.nexscope.productDiscovery.discoverProducts, {});
  },
});

export const upsertAmazonProduct = internalMutation({
  args: {
    niche: v.string(),
    asin: v.string(),
    title: v.string(),
    price: v.number(),
    cost: v.optional(v.number()),
    imageUrl: v.string(),
    supplierUrl: v.string(),
    aiScore: v.number(),
    trend: v.string(),
    reviewCount: v.optional(v.number()),
    isPick: v.optional(v.boolean()), // one of this niche's daily picks (default true)
  },
  handler: async (ctx, args): Promise<{ outcome: "created" | "updated"; productId: Id<"products"> }> => {
    // The listing's own title decides its category (a "resistance bands"
    // search for Health & Wellness returns Sports gear); the searched niche
    // only decides which daily pick it fills.
    const category = classifyNiche({ title: args.title, url: args.supplierUrl }, args.niche);
    const description = args.reviewCount
      ? `Real Amazon bestseller candidate in ${category}, backed by ${args.reviewCount.toLocaleString()} reviews and strong recent click demand.`
      : `Real Amazon bestseller candidate in ${category}, based on recent click demand.`;

    const productDoc = {
      title: args.title,
      description,
      imageUrl: args.imageUrl,
      price: args.price,
      cost: args.cost,
      category,
      tags: [category, "Amazon", "market data"],
      winnerSlot: winnerSlot("nexscope_api", args.niche),
      aiScore: args.aiScore,
      saturation: "Unknown",
      trend: args.trend,
      supplierUrl: args.supplierUrl,
      adExamples: [] as { platform: string; impressions: string; imageUrl: string }[],
      isWinnerOfDay: args.isPick ?? true,
      source: "nexscope_api",
      priceSource: "exact" as const,
    };

    const existingLink = await ctx.db
      .query("nexscopeSyncedProducts")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.asin))
      .unique();

    if (existingLink && (await ctx.db.get("products", existingLink.productId))) {
      await ctx.db.patch("products", existingLink.productId, productDoc);
      await ctx.db.patch("nexscopeSyncedProducts", existingLink._id, { lastSyncedAt: new Date().toISOString() });
      return { outcome: "updated", productId: existingLink.productId };
    }
    if (existingLink) await ctx.db.delete("nexscopeSyncedProducts", existingLink._id); // product was deleted by an admin — recreate

    await markStatsDirty(ctx);
    const productId = await ctx.db.insert("products", {
      ...productDoc,
      publishedAt: new Date().toISOString(),
    });
    await ctx.db.insert("nexscopeSyncedProducts", {
      externalId: args.asin,
      productId,
      lastSyncedAt: new Date().toISOString(),
    });
    return { outcome: "created", productId };
  },
});

// Which keyword each niche searches next (counts up once per run).
export const nextRun = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ run: number; storesBackfilled: boolean }> => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "nexscopeDiscovery")).unique();
    const state = (doc?.data ?? {}) as { run?: number; storesBackfilled?: boolean };
    const run = state.run ?? 0;
    const data = { ...state, run: run + 1 };
    const updatedAt = new Date().toISOString();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt });
    else await ctx.db.insert("siteStats", { key: "nexscopeDiscovery", data, updatedAt });
    return { run, storesBackfilled: !!state.storesBackfilled };
  },
});

export const markStoresBackfilled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "nexscopeDiscovery")).unique();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data: { ...(doc.data as object), storesBackfilled: true } });
  },
});

// Products imported from Shopify, a page at a time (for the store backfill).
export const shopifyProductsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("products").paginate({ numItems: 500, cursor: args.cursor });
    return { items: page.page.filter((p) => p.source === "shopify"), isDone: page.isDone, cursor: page.continueCursor };
  },
});

// A TikTok Shop or Shopify product from Nexscope (see marketplaces.ts).
// Deduped by external id like the Amazon ones; these never take a daily
// pick slot — the Winning Products list ranks them by score like any product.
export const upsertDiscovered = internalMutation({
  args: {
    source: v.string(),
    externalId: v.string(),
    title: v.string(),
    price: v.optional(v.number()),
    originalPrice: v.optional(v.string()),
    imageUrl: v.string(),
    supplierUrl: v.string(),
    storeUrl: v.optional(v.string()),
    category: v.string(),
    aiScore: v.number(),
    trend: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ outcome: "created" | "updated"; productId: Id<"products"> }> => {
    const { externalId, ...fields } = args;
    const productDoc = {
      ...fields,
      saturation: "Unknown",
      adExamples: [] as { platform: string; impressions: string; imageUrl: string }[],
      isWinnerOfDay: false,
      ...(args.price !== undefined ? { priceSource: "exact" as const } : {}),
    };
    const link = await ctx.db
      .query("nexscopeSyncedProducts")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (link && (await ctx.db.get("products", link.productId))) {
      await ctx.db.patch("products", link.productId, productDoc);
      await ctx.db.patch("nexscopeSyncedProducts", link._id, { lastSyncedAt: new Date().toISOString() });
      return { outcome: "updated", productId: link.productId };
    }
    if (link) await ctx.db.delete("nexscopeSyncedProducts", link._id);
    await markStatsDirty(ctx);
    const productId = await ctx.db.insert("products", { ...productDoc, publishedAt: new Date().toISOString() });
    await ctx.db.insert("nexscopeSyncedProducts", { externalId, productId, lastSyncedAt: new Date().toISOString() });
    return { outcome: "created", productId };
  },
});

// The store of a discovered Shopify product. New stores start with what the
// product tells us; an existing store (e.g. from the Shopify store import)
// keeps its numbers and only gains the product as a best-seller.
export const upsertProductStore = internalMutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    url: v.string(),
    logoUrl: v.string(),
    niche: v.string(),
    activeAdsCount: v.number(),
    bestSeller: v.object({ title: v.string(), imageUrl: v.string(), price: v.number(), estSalesRange: v.string() }),
  },
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const now = new Date().toISOString();
    const link = await ctx.db
      .query("syncLinks")
      .withIndex("by_kind_external", (q) => q.eq("kind", "store").eq("externalId", args.externalId))
      .unique();
    const existing = link ? await ctx.db.get("stores", link.docId as Id<"stores">) : null;
    if (link && existing) {
      const others = existing.bestSellers.filter((b) => b.title !== args.bestSeller.title);
      await ctx.db.patch("stores", existing._id, {
        bestSellers: [args.bestSeller, ...others].slice(0, 8),
        activeAdsCount: Math.max(existing.activeAdsCount, args.activeAdsCount),
      });
      await ctx.db.patch("syncLinks", link._id, { lastSyncedAt: now });
      return "updated";
    }
    if (link) await ctx.db.delete("syncLinks", link._id);
    const storeId = await ctx.db.insert("stores", {
      name: args.name,
      url: args.url,
      logoUrl: args.logoUrl,
      niche: args.niche,
      country: "US",
      platform: "Shopify",
      estimatedRevenueRange: "Unknown",
      trafficRange: "Unknown",
      activeAdsCount: args.activeAdsCount,
      bestSellers: [args.bestSeller],
      isHighTraffic: false,
      spottedAt: now,
    });
    await ctx.db.insert("syncLinks", { kind: "store", externalId: args.externalId, docId: storeId, source: "nexscope", lastSyncedAt: now });
    return "created";
  },
});

export const retireOldWinners = internalMutation({
  args: { niche: v.string(), keepIds: v.array(v.id("products")) },
  handler: async (ctx, args) => retireStaleWinners(ctx, { source: "nexscope_api", niche: args.niche }, args.keepIds),
});
