import { v, ConvexError } from "convex/values";
import { internalAction, action, internalQuery, internalMutation } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel.d.ts";
import {
  NEXSCOPE_AMAZON_DISCOVERY_URL,
  NICHE_TO_AMAZON_KEYWORD,
  averagePriceAndCost,
  type NexscopeAmazonDiscoveryResponse,
} from "./client";

type PricingResult = {
  updated: number;
  skipped: number;
  errors: string[];
};

// Backfills price/cost onto Winning Products that were auto-synced from
// AdLibrary.com (which has no price data) using Nexscope's Amazon market
// data as an honest category benchmark. Only touches products still missing
// a price — never overwrites admin-curated or already-priced rows.
export const backfillProductPricing = internalAction({
  args: {},
  handler: async (ctx): Promise<PricingResult> => {
    const apiKey = process.env.NEXSCOPE_API_KEY;
    if (!apiKey) {
      return { updated: 0, skipped: 0, errors: ["NEXSCOPE_API_KEY secret is not set. Add it in the Secrets tab."] };
    }

    const unpriced: Doc<"products">[] = await ctx.runQuery(internal.nexscope.pricing.listUnpricedSyncedProducts, {});
    const result: PricingResult = { updated: 0, skipped: 0, errors: [] };

    // One request per distinct niche among unpriced products, not per
    // product, since the benchmark is a category average.
    const niches = [...new Set(unpriced.map((p) => p.category))];
    const priceByNiche = new Map<string, { price?: number; cost?: number }>();

    for (const niche of niches) {
      const keyword = NICHE_TO_AMAZON_KEYWORD[niche];
      if (!keyword) {
        result.errors.push(`${niche}: no Amazon keyword mapping configured`);
        continue;
      }
      try {
        const response = await fetch(NEXSCOPE_AMAZON_DISCOVERY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ keyword, countryCode: "US", page: 1, pageSize: 10 }),
        });

        if (!response.ok) {
          const text = await response.text();
          result.errors.push(`${niche}: Nexscope API error ${response.status} — ${text.slice(0, 200)}`);
          continue;
        }

        const data: NexscopeAmazonDiscoveryResponse = await response.json();
        if (data.code !== 0) {
          result.errors.push(`${niche}: Nexscope returned error — ${data.msg ?? "unknown"}`);
          continue;
        }

        const products = data.data?.products ?? [];
        const benchmark = averagePriceAndCost(products);
        if (benchmark.price === undefined) {
          result.errors.push(`${niche}: no priced Amazon results found`);
          continue;
        }
        priceByNiche.set(niche, benchmark);
      } catch (error) {
        result.errors.push(`${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    for (const product of unpriced) {
      const benchmark = priceByNiche.get(product.category);
      if (!benchmark || benchmark.price === undefined) {
        result.skipped += 1;
        continue;
      }
      await ctx.runMutation(internal.nexscope.pricing.applyPricing, {
        productId: product._id,
        price: benchmark.price,
        cost: benchmark.cost,
      });
      result.updated += 1;
    }

    return result;
  },
});

// Admin-triggered manual pricing backfill.
export const backfillPricingNow = action({
  args: {},
  handler: async (ctx): Promise<PricingResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return await ctx.runAction(internal.nexscope.pricing.backfillProductPricing, {});
  },
});

export const listUnpricedSyncedProducts = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"products">[]> => {
    const synced = await ctx.db
      .query("products")
      .withIndex("by_published")
      .order("desc")
      .take(200);
    return synced.filter((p) => p.source === "adlibrary_api" && p.price === undefined);
  },
});

export const applyPricing = internalMutation({
  args: {
    productId: v.id("products"),
    price: v.number(),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("products", args.productId, {
      price: args.price,
      cost: args.cost,
      priceSource: "estimated_market",
    });
    return null;
  },
});

