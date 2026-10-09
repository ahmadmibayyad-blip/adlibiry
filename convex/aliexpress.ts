import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ALIEXPRESS_ENDPOINT, SUPPLIER_FIELDS, fromApifySearch, productsFromResponse, searchKeywords, signParams, topMatches } from "./lib/aliexpress";
import { stableToken } from "./lib/authIdentity";

// Daily (crons.ts → importRuns "aliexpressCosts"): supplier sourcing from the
// AliExpress Affiliate API. For products with a price, the top 3 suppliers by
// title match (price, rating, orders, affiliate link) are saved for the
// product page's Suppliers section, and the best one's price + shipping
// becomes the landed cost when the product has none.
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
      if ((p.costCheckedAt && p.costCheckedAt > cutoff) || p.isService) continue;
      out.push({ id: p._id, title: p.title });
      if (out.length >= PER_RUN) break;
    }
    return out;
  },
});

const matchValidator = v.object({
  title: v.string(),
  price: v.number(),
  url: v.string(),
  imageUrl: v.optional(v.string()),
  rating: v.optional(v.number()),
  orders: v.optional(v.number()),
  similarity: v.number(),
});

export const saveSuppliers = internalMutation({
  args: { id: v.id("products"), matches: v.array(matchValidator), shipping: v.number() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("products", args.id);
    if (!p) return;
    const best = args.matches[0];
    // Our cost only fills a gap (or refreshes an earlier AliExpress cost); a cost an admin or import set stays.
    const setCost = best && (p.cost === undefined || p.costSource === "aliexpress");
    await ctx.db.patch("products", args.id, {
      costCheckedAt: new Date().toISOString(),
      supplierMatches: args.matches,
      ...(setCost ? { cost: Math.round((best.price + args.shipping) * 100) / 100, costSource: "aliexpress", costUrl: best.url } : {}),
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
        fields: SUPPLIER_FIELDS,
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
        const matches = topMatches(item.title, products);
        await ctx.runMutation(internal.aliexpress.saveSuppliers, { id: item.id, matches, shipping });
        if (matches.length) out.updated++;
      } catch (e) {
        out.errors.push(`${item.title.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  },
});

// ── On demand: suppliers when a product page opens ─────────────────────────
// The daily job above needs the Affiliate API and reaches 60 products a day, so
// most products had no suppliers. When a signed-in user opens a product with
// none, findSuppliers searches AliExpress by title through the Apify reader
// (APIFY_TOKEN; ALIEXPRESS_IMPORT_ACTOR, default zen-studio/aliexpress-scraper):
// about $0.08 a search, capped at $0.10, and SUPPLIER_LOOKUPS_PER_DAY (default
// 100, 0 turns it off) across all users. The result is saved for everyone.

const LOOKUP_RETRY_DAYS = 7; // a search that found nothing (or failed) is tried again after this

export const claimLookup = internalMutation({
  args: { productId: v.id("products"), token: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<{ title: string } | { skip: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { skip: "signed out" };
    const p = await ctx.db.get("products", args.productId);
    if (!p || p.isService) return { skip: "not a product" };
    if (p.supplierMatches?.length) return { skip: "already has suppliers" };
    const now = new Date();
    const retry = new Date(now.getTime() - LOOKUP_RETRY_DAYS * 86_400_000).toISOString();
    if ((p.supplierLookupAt ?? "") > retry || (p.costCheckedAt ?? "") > retry) return { skip: "searched recently" };
    const day = now.toISOString().slice(0, 10);
    const used = await ctx.db.query("supplierLookupUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return { skip: "daily limit reached" };
    if (used) await ctx.db.patch("supplierLookupUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("supplierLookupUsage", { day, count: 1 });
    await ctx.db.patch("products", p._id, { supplierLookupAt: now.toISOString() });
    return { title: p.title };
  },
});

export const findSuppliers = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ found: number } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { skipped: "signed out" };
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) return { skipped: "APIFY_TOKEN isn't set" };
    const limit = Math.max(0, Number(process.env.SUPPLIER_LOOKUPS_PER_DAY ?? 100) || 0);
    const claim = await ctx.runMutation(internal.aliexpress.claimLookup, { productId: args.productId, token: stableToken(identity), limit });
    if ("skip" in claim) return { skipped: claim.skip };
    const actor = (process.env.ALIEXPRESS_IMPORT_ACTOR?.trim() || "zen-studio/aliexpress-scraper").replace("/", "~");
    const q = new URLSearchParams({ token, timeout: "90", maxTotalChargeUsd: "0.1" });
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: [searchKeywords(claim.title)],
          maxResults: 10,
          country: "US",
          currency: "USD",
          language: "en_US",
          sort: "relevance",
          includeProductDetails: false,
          includeDescription: false,
          includeReviews: false,
        }),
        signal: AbortSignal.timeout(110_000),
      });
      if (!res.ok) {
        console.warn("Suppliers: Apify AliExpress search", res.status, (await res.text()).slice(0, 200));
        return { skipped: "search failed" };
      }
      const matches = topMatches(claim.title, fromApifySearch(await res.json().catch(() => null)));
      const shipping = Number(process.env.ALIEXPRESS_SHIPPING_USD ?? 3) || 0;
      await ctx.runMutation(internal.aliexpress.saveSuppliers, { id: args.productId, matches, shipping });
      return { found: matches.length };
    } catch (e) {
      console.warn("Suppliers: Apify AliExpress search failed", e);
      return { skipped: "search failed" };
    }
  },
});
