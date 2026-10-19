/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { aliexpressBySales, amazonMarket, amazonResults, boughtLastMonth, marketDue, shortKeywords, tiktokShopProducts, tiktokVideos, type ProductMarkets } from "./lib/justone";

const modules = import.meta.glob("./**/*.ts");
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: "", data }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

// Shapes as JustOne answered them (October 2026), cut down.
const ALI = {
  result: {
    base: { totalResults: "7528" },
    resultList: [
      { item: { averageStarRate: 4.9, image: "//ae-pic-a1.aliexpress-media.com/kf/S2e.png", itemId: "3256810165810447", itemUrl: "//www.aliexpress.com/item/3256810165810447.html", sales: "3362", sku: { def: { price: null, promotionPrice: 4.82 } }, title: "Portable Pet Paw Cleaner" } },
      { item: { itemId: "", title: "no id" } },
    ],
  },
};
const AMAZON = {
  country: "DE",
  domain: "www.amazon.de",
  total_products: 2127,
  products: [
    { asin: "B01N52Z30T", currency: "EUR", is_best_seller: false, is_amazon_choice: true, product_num_ratings: 12635, product_photo: "https://m.media-amazon.com/x.jpg", product_price: "27,50 €", product_star_rating: "4.4", product_title: "Dexas Pfotenreiniger", product_url: "https://www.amazon.de/dp/B01N52Z30T", sales_volume: "100+ Mal im letzten Monat gekauft" },
  ],
};
const TIKTOK = {
  search_item_list: [
    { aweme_info: { aweme_id: "7690351839132306709", desc: "#dogpaw", create_time: 1790549577, author: { unique_id: "vet.pimple.popper" }, statistics: { digg_count: 8397, play_count: 226846, share_count: 1367 }, share_url: "https://www.tiktok.com/@vet.pimple.popper/video/7690351839132306709?_r=1", video: { cover: { url_list: ["https://p16.tiktokcdn-us.com/c.jpg"] } } } },
  ],
};
const SHOP = {
  code: 0,
  data: {
    products: [
      { product_id: "1731288426724233804", title: "Beautiful dog dress", image: { url_list: ["https://p16-oec.ttcdn-us.com/a.webp"] }, product_price_info: { currency_name: "USD", sale_price_decimal: "9.5" }, rate_info: { review_count: "2", score: 5 }, seller_info: { shop_name: "FRENCHIES USA" }, seo_url: { canonical_url: "https://shop.tiktok.com/us/pdp/beautiful-dog-dress/1731288426724233804" }, sold_info: { sold_count: 44 } },
    ],
  },
};

describe("reading JustOne answers", () => {
  it("reads AliExpress best sellers", () => {
    expect(aliexpressBySales(ALI)).toEqual({
      total: 7528,
      items: [{ id: "3256810165810447", title: "Portable Pet Paw Cleaner", url: "https://www.aliexpress.com/item/3256810165810447.html", image: "https://ae-pic-a1.aliexpress-media.com/kf/S2e.png", priceUsd: 4.82, sold: 3362, rating: 4.9 }],
    });
  });

  it("reads Amazon results with the local price and last month's sales", () => {
    const r = amazonResults(AMAZON);
    expect(r.total).toBe(2127);
    expect(r.items[0]).toMatchObject({ asin: "B01N52Z30T", price: 27.5, priceText: "27,50 €", currency: "EUR", ratings: 12635, stars: 4.4, boughtLastMonth: 100, amazonChoice: true });
    expect(r.items[0].bestSeller).toBeUndefined();
    expect(["1K+ bought in past month", "2.000+ Mal im letzten Monat gekauft", "50+ bought", "1,5K+ gekauft", undefined].map(boughtLastMonth)).toEqual([1000, 2000, 50, 1500, undefined]);
  });

  it("reads TikTok videos and TikTok Shop products", () => {
    expect(tiktokVideos(TIKTOK)[0]).toEqual({
      id: "7690351839132306709", url: "https://www.tiktok.com/@vet.pimple.popper/video/7690351839132306709", text: "#dogpaw", author: "vet.pimple.popper",
      cover: "https://p16.tiktokcdn-us.com/c.jpg", likes: 8397, plays: 226846, shares: 1367, createdAt: new Date(1790549577000).toISOString(),
    });
    expect(tiktokShopProducts(SHOP).items[0]).toEqual({
      id: "1731288426724233804", title: "Beautiful dog dress", url: "https://shop.tiktok.com/us/pdp/beautiful-dog-dress/1731288426724233804", image: "https://p16-oec.ttcdn-us.com/a.webp",
      price: 9.5, currency: "USD", sold: 44, rating: 5, reviews: 2, shop: "FRENCHIES USA",
    });
    expect(tiktokShopProducts({ region: "GB", region_supported: false, supported_regions: ["US"] })).toEqual({ items: [], unsupported: true });
  });

  it("picks the Amazon marketplace, search words and when to look again", () => {
    expect(["SE", "DK", "NO", "us", null, "ZZ"].map(amazonMarket)).toEqual(["SE", "DE", "SE", "US", "DE", "DE"]);
    expect(shortKeywords("Portable Dog Paw Cleaner Cup with Soft Silicone Bristles", 4)).toBe("Portable Dog Paw Cleaner");
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(marketDue(undefined, undefined, now)).toBe(true);
    expect(marketDue("2026-10-15T12:00:00Z", false, now)).toBe(false);
    expect(marketDue("2026-10-11T12:00:00Z", false, now)).toBe(true);
    expect(marketDue("2026-10-17T12:00:00Z", true, now)).toBe(true);
  });
});

describe("product page lookups", () => {
  beforeEach(() => {
    process.env.JUSTONE_API_KEY = "jo-test";
    delete process.env.JUSTONE_LOOKUPS_PER_DAY;
  });

  const product = {
    title: "Portable Dog Paw Cleaner Cup", description: "", imageUrl: "i", category: "Pet Supplies", tags: [], aiScore: 80,
    saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
  };

  const setup = async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", targetCountry: "DK" });
      return ctx.db.insert("products", product);
    });
    return { t, productId, me: t.withIdentity({ subject: "u1|s" }) };
  };

  it("looks up all four once, saves them on the product and keeps them a week", async () => {
    const { t, productId, me } = await setup();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      if (String(u).includes("/aliexpress/")) return ok(ALI);
      if (String(u).includes("/amazon/")) return ok(AMAZON);
      if (String(u).includes("/tiktok-shop/")) return ok(SHOP);
      return ok(TIKTOK);
    });
    const r = await me.action(api.justone.marketsFor, { productId });
    expect(r).toEqual({ looked: ["aliexpress", "amazon", "tiktok", "tiktokShop"] });
    expect(asked.find((u) => u.includes("/amazon/"))).toContain("country=DE"); // Denmark shops on amazon.de
    expect(asked.find((u) => u.includes("/tiktok-shop/"))).toContain("region=US");
    expect(asked.every((u) => u.includes("token=jo-test"))).toBe(true);
    const p = await t.run((ctx) => ctx.db.get("products", productId));
    const m = p?.markets as ProductMarkets;
    expect(m.aliexpress?.items[0].sold).toBe(3362);
    expect(m.amazon?.DE?.items[0].boughtLastMonth).toBe(100);
    expect(m.tiktok?.items[0].likes).toBe(8397);
    expect(m.tiktokShop?.items[0].shop).toBe("FRENCHIES USA");
    expect(await me.action(api.justone.marketsFor, { productId })).toEqual({ skipped: "nothing due" });
    expect(asked).toHaveLength(4);
  });

  it("keeps the last good answer when one fails and stops at the daily cap", async () => {
    const { t, productId, me } = await setup();
    await t.run((ctx) => ctx.db.patch("products", productId, { markets: { tiktok: { at: "2026-10-01T00:00:00.000Z", items: [{ id: "old", url: "u", likes: 5 }] } } }));
    vi.stubGlobal("fetch", async (u: string) => (String(u).includes("/tiktok/") ? new Response(JSON.stringify({ code: 601, message: "Insufficient Balance" })) : ok(ALI)));
    await me.action(api.justone.marketsFor, { productId });
    const p = await t.run((ctx) => ctx.db.get("products", productId));
    expect((p?.markets as ProductMarkets).tiktok).toMatchObject({ failed: true, items: [{ id: "old" }] });

    process.env.JUSTONE_LOOKUPS_PER_DAY = "1";
    const second = await t.run((ctx) => ctx.db.insert("products", { ...product, title: "Cat Window Hammock" }));
    expect(await me.action(api.justone.marketsFor, { productId: second })).toEqual({ skipped: "nothing due" });
  });
});

describe("TikTok Shop search", () => {
  it("searches live, answers repeats from the cache and keeps to the daily limit", async () => {
    process.env.JUSTONE_API_KEY = "jo-test";
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return ok(SHOP);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.justone.tiktokShopSearch, { keyword: "dog dress", region: "US" });
    expect(r).toMatchObject({ cached: false, region: "US", items: [{ title: "Beautiful dog dress", sold: 44 }] });
    expect((await me.action(api.justone.tiktokShopSearch, { keyword: " Dog  dress ", region: "US" })).cached).toBe(true);
    expect(calls).toBe(1);
    await me.action(api.justone.tiktokShopSearch, { keyword: "cat bed" }); // the free tier's 2nd
    await expect(me.action(api.justone.tiktokShopSearch, { keyword: "lamp" })).rejects.toThrow(/2 times today/);
  });
});
