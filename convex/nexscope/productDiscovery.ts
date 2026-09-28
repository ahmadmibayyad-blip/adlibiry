import { markStatsDirty } from "../stats";
import { v, ConvexError } from "convex/values";
import { internalAction, action, internalMutation } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { retireStaleWinners, winnerSlot } from "../lib/winners";
import { classifyNiche } from "../lib/category";
import { findPayload, nestedError } from "../lib/nexscopeReply";
import {
  NEXSCOPE_AMAZON_DISCOVERY_URL,
  NICHE_TO_AMAZON_KEYWORD,
  scoreFromAmazonSignals,
  trendFromClickGrowth,
  deriveCostFromMargin,
  type NexscopeAmazonProduct,
  type NexscopeAmazonDiscoveryResponse,
} from "./client";

// Winning Products: discovers real Amazon bestseller candidates per niche
// from Nexscope.ai — each one a real, single ASIN with its own real title,
// image, and price (unlike the AdLibrary-derived products, which have no
// price and get a category-average benchmark instead). Deduped by ASIN so
// re-running updates existing rows instead of creating duplicates.

type DiscoveryResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const PRODUCTS_PER_NICHE = 2;

export const discoverProducts = internalAction({
  args: {},
  handler: async (ctx): Promise<DiscoveryResult> => {
    const apiKey = process.env.NEXSCOPE_API_KEY;
    if (!apiKey) {
      return { created: 0, updated: 0, skipped: 0, errors: ["NEXSCOPE_API_KEY secret is not set. Add it in the Secrets tab."] };
    }

    const result: DiscoveryResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const [niche, keyword] of Object.entries(NICHE_TO_AMAZON_KEYWORD)) {
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

        const keepIds: Id<"products">[] = [];
        for (const product of candidates.slice(0, PRODUCTS_PER_NICHE)) {
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
          });
          keepIds.push(outcome.productId);
          if (outcome.outcome === "created") result.created += 1;
          else result.updated += 1;
        }
        // Today's picks are this niche's Nexscope winners; earlier picks retire.
        await ctx.runMutation(internal.nexscope.productDiscovery.retireOldWinners, { niche, keepIds });
      } catch (error) {
        result.errors.push(`${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
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
      isWinnerOfDay: true,
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

export const retireOldWinners = internalMutation({
  args: { niche: v.string(), keepIds: v.array(v.id("products")) },
  handler: async (ctx, args) => retireStaleWinners(ctx, { source: "nexscope_api", niche: args.niche }, args.keepIds),
});
