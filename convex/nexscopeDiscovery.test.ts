/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { NICHE_DISCOVERY_KEYWORDS } from "./nexscope/client";

const modules = import.meta.glob("./**/*.ts");

// Fake Nexscope. Amazon: 3 usable listings per search, unique per keyword.
// TikTok Shop: 2 products. Shopify: 1 product per keyword.
function stubNexscope(searched: string[]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { keyword?: string; searchKey?: string; page?: number };
    if (url.includes("tiktok-top-selling-products")) {
      const products = [1, 2].map((n) => ({
        productId: `tt${body.page}-${n}`, title: `Pet hair remover roller ${n}`, price: 12.5, currency: "USD",
        totalSaleCnt: 90_000, totalSale1dCnt: 1_200, growthRate: 40, categoryName: "Pet Supplies", imageUrl: "https://img.example.com/tt.jpg",
      }));
      return new Response(JSON.stringify({ errcode: 200, data: { products } }), { status: 200 });
    }
    if (url.includes("shopify-product-query")) {
      const products = [{
        productId: `sh-${body.searchKey}`, title: `${body.searchKey} deluxe`, productLink: "https://store.example.com/products/x",
        previewImageUrl: "https://img.example.com/sh.jpg", minPrice: "29.90", facebookAdCount: "14", weekOrderCount: "320", weekRevenueGrowth: "25",
      }];
      return new Response(JSON.stringify({ total: 1, products }), { status: 200 });
    }
    const keyword = body.keyword!;
    searched.push(keyword);
    const slug = keyword.replace(/\W+/g, "-");
    const products = [1, 2, 3].map((n) => ({
      asin: `${slug}-${n}`,
      title: `${keyword} model ${n}`,
      price: 20 + n,
      imageUrl: `https://img.example.com/${slug}-${n}.jpg`,
    }));
    products.push({ asin: "", title: "no asin", price: 1, imageUrl: "" }); // unusable
    return new Response(JSON.stringify({ products }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Nexscope product discovery", () => {
  it("saves every usable listing and searches a new keyword each run", async () => {
    process.env.NEXSCOPE_API_KEY = "test";
    const t = convexTest(schema, modules);
    const searched: string[] = [];
    stubNexscope(searched);
    const niches = Object.keys(NICHE_DISCOVERY_KEYWORDS).length;

    const first = await t.action(internal.nexscope.productDiscovery.discoverProducts, {});
    expect(first).toMatchObject({ created: 3 * niches + 2 + niches, updated: 0, skipped: niches, errors: [] });
    expect(first.bySource).toEqual({
      Amazon: { created: 3 * niches, updated: 0 },
      "TikTok Shop": { created: 2, updated: 0 },
      Shopify: { created: niches, updated: 0 },
    });

    const second = await t.action(internal.nexscope.productDiscovery.discoverProducts, {});
    expect(second.created).toBe(3 * niches + 2 + niches); // new keywords and TikTok page → new products
    expect(new Set(searched).size).toBe(2 * niches);

    const picks = await t.run((ctx) => ctx.db.query("products").withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true)).collect());
    expect(picks).toHaveLength(2 * niches); // only the latest run's top 2 Amazon listings per niche

    const tt = await t.run((ctx) => ctx.db.query("products").filter((q) => q.eq(q.field("source"), "tiktok_shop")).first());
    expect(tt).toMatchObject({ category: "Pet Supplies", price: 12.5, trend: "Rising", isWinnerOfDay: false });
    const sh = await t.run((ctx) => ctx.db.query("products").filter((q) => q.eq(q.field("source"), "shopify")).first());
    expect(sh).toMatchObject({ price: 29.9, supplierUrl: "https://store.example.com/products/x", trend: "Rising" });
  });
});
