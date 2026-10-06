import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ALIEXPRESS_ENDPOINT, pickMatch, productsFromResponse, searchKeywords, signParams } from "./lib/aliexpress";

// Daily (crons.ts → importRuns "aliexpressCosts"): landed cost for products
// that have a price but no supplier cost, from the AliExpress Affiliate API.
// Needs Convex env ALIEXPRESS_APP_KEY and ALIEXPRESS_APP_SECRET (AliExpress
// Open Platform, affiliate app); optional ALIEXPRESS_TRACKING_ID and
// ALIEXPRESS_SHIPPING_USD (shipping estimate added to the price, default 3).
// The pipeline then computes margin = price − cost (marginPercent, filterable).

const PER_RUN = 60;
const RECHECK_DAYS = 30;

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
    const out: { id: Id<"products">; title: string }[] = [];
    const rows = await ctx.db.query("products").withIndex("by_price", (q) => q.gt("price", 0)).order("desc").take(3000);
    for (const p of rows) {
      if (p.cost !== undefined || (p.costCheckedAt && p.costCheckedAt > cutoff) || p.isService) continue;
      out.push({ id: p._id, title: p.title });
      if (out.length >= PER_RUN) break;
    }
    return out;
  },
});

export const saveCost = internalMutation({
  args: { id: v.id("products"), cost: v.optional(v.number()), url: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("products", args.id);
    if (!p) return;
    const checkedAt = new Date().toISOString();
    if (args.cost === undefined || p.cost !== undefined) return void (await ctx.db.patch("products", args.id, { costCheckedAt: checkedAt }));
    await ctx.db.patch("products", args.id, {
      cost: args.cost,
      costSource: "aliexpress",
      costCheckedAt: checkedAt,
      ...(args.url ? { costUrl: args.url } : {}),
    });
  },
});

export const dailyCosts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; updated: number; errors: string[] }> => {
    const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
    const secret = process.env.ALIEXPRESS_APP_SECRET?.trim();
    if (!appKey || !secret) return { notConfigured: "ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET aren't set" };
    const shipping = Number(process.env.ALIEXPRESS_SHIPPING_USD ?? 3) || 0;
    const todo = await ctx.runQuery(internal.aliexpress.candidates, {});
    const out = { fetched: 0, updated: 0, errors: [] as string[] };
    for (const item of todo) {
      const params: Record<string, string> = {
        method: "aliexpress.affiliate.product.query",
        app_key: appKey,
        sign_method: "sha256",
        timestamp: String(Date.now()),
        keywords: searchKeywords(item.title),
        target_currency: "USD",
        target_language: "EN",
        ship_to_country: "US",
        page_size: "10",
        fields: "product_id,product_title,target_sale_price,product_detail_url",
        ...(process.env.ALIEXPRESS_TRACKING_ID ? { tracking_id: process.env.ALIEXPRESS_TRACKING_ID } : {}),
      };
      try {
        params.sign = await signParams(params, secret);
        const res = await fetch(ALIEXPRESS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
          body: new URLSearchParams(params),
          signal: AbortSignal.timeout(15_000),
        });
        const body = await res.json();
        const products = productsFromResponse(body);
        out.fetched += products.length;
        const match = pickMatch(item.title, products);
        await ctx.runMutation(internal.aliexpress.saveCost, {
          id: item.id,
          ...(match ? { cost: Math.round((match.price + shipping) * 100) / 100, url: match.url } : {}),
        });
        if (match) out.updated++;
      } catch (e) {
        out.errors.push(`${item.title.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  },
});
