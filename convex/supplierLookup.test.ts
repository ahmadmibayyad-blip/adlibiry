/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { fromApifySearch, headNoun, searchKeywords, supplierMatchScore, topMatches } from "./lib/aliexpress";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const RESULTS = [
  { title: "Self Cleaning Slicker Brush for Dogs and Cats Pet Grooming", price: 2.15, currency: "USD", url: "https://www.aliexpress.com/item/1005001.html", gallery: ["https://ae01.alicdn.com/a.jpg"] },
  { title: "Pet Hair Remover Self Cleaning Brush Cat Dog", price: 1.09, currency: "USD", productId: "1005002" },
  { title: "Wireless Earbuds Bluetooth 5.3", price: 4.5, currency: "USD", url: "https://www.aliexpress.com/item/1005003.html" },
  { title: "No price brush", currency: "USD", url: "https://www.aliexpress.com/item/1005004.html" },
];

describe("AliExpress suppliers on demand", () => {
  it("reads Apify search results in the Affiliate API's shape", () => {
    expect(fromApifySearch(RESULTS)).toEqual([
      { product_title: RESULTS[0].title, target_sale_price: "2.15", product_detail_url: RESULTS[0].url, product_main_image_url: "https://ae01.alicdn.com/a.jpg" },
      { product_title: RESULTS[1].title, target_sale_price: "1.09", product_detail_url: "https://www.aliexpress.com/item/1005002.html" },
      { product_title: RESULTS[2].title, target_sale_price: "4.5", product_detail_url: RESULTS[2].url },
    ]);
    expect(fromApifySearch([{ title: "Brush", price: 12, currency: "EUR", url: "https://x" }])).toEqual([]);
    expect(fromApifySearch(null)).toEqual([]);
  });

  it("matches a real search (Apify run, 2026-10-09) to the product by title", () => {
    const real = [
      { title: "Pet Dog Brush Cat Comb Self Cleaning Pet Hair Remover Brush For Dogs Cats Grooming Tools Pets Dematting Comb Dogs Accessories", price: 2.52, currency: "USD", url: "https://www.aliexpress.com/item/3256812949370751.html", image: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg" },
      { title: "Self Cleaning Slicker Brush for Dog and Cat Removes Undercoat Tangled Hair Massages Particle Pet Comb Improves Circulation", price: 1.09, currency: "USD", url: "https://www.aliexpress.com/item/3256801542436776.html", image: "https://ae-pic-a1.aliexpress-media.com/kf/b.jpg" },
      { title: "Pet Hair Removel Roller Remover Cleaning Brush Fur Removing Dog Cat Animals Hair Brush Car Clothing Couch Sofa Carpets Combs", price: 2.33, currency: "USD", url: "https://www.aliexpress.com/item/3256805433298991.html" },
    ];
    const m = topMatches("Self-cleaning pet brush for dogs and cats", fromApifySearch(real));
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]).toMatchObject({ imageUrl: expect.stringContaining("aliexpress-media.com") });
  });

  it("matches keyword-stuffed AliExpress titles (real Apify run, 2026-10-10) and rejects other products", () => {
    const product = "2 x Resistance Band Leggings (Buy 1 & Get 1 Free)";
    expect(headNoun(product)).toBe("legging");
    expect(searchKeywords(product)).toBe("Resistance Band Leggings");
    const real = [
      { title: "Women Sports Leggings Seamless Yoga Long Pants Low Band Fitness Leggings Compress The Hips Tights Gym Workout Pants", price: 2.59, currency: "USD", url: "https://www.aliexpress.com/item/a.html" },
      { title: "NCLAGEN Yoga Leggings Women Seamless Sports Pants Low Ribbed Band Gym Clothes Fitness Workout Wear Scrunch Bum Tights", price: 3.43, currency: "USD", url: "https://www.aliexpress.com/item/b.html" },
      { title: "1pc Stackable Heavy Tension TPE Resistance Band Set - Anti-Snap for Home Gym Muscle Strength & Body Stretching Yoga Gym", price: 0.33, currency: "USD", url: "https://www.aliexpress.com/item/c.html" },
    ];
    const m = topMatches(product, fromApifySearch(real));
    expect(m.map((x) => x.url)).toEqual(["https://www.aliexpress.com/item/a.html", "https://www.aliexpress.com/item/b.html"]); // leggings, not the band set
    expect(m[0].similarity).toBeGreaterThanOrEqual(0.5);
    // A fountain title whose first 8 words never say "fountain" still searches for one.
    const fountain = "Veken Innovation Award Winner Stainless Steel Cat Water Fountain 108oz C1";
    expect(searchKeywords(fountain).split(" ")).toContain("fountain");
    expect(supplierMatchScore(fountain, "Stainless Steel Cat Water Fountain 3.2L Automatic Pet Drinking Dispenser Quiet Pump")).toBeGreaterThanOrEqual(0.5);
    expect(supplierMatchScore(fountain, "Cat Water Fountain Filter Replacement Cotton 6pcs")).toBeLessThan(0.5);
  });

  it("searches once when a product page opens, saves the matches for everyone, and keeps to the daily limit", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    vi.stubEnv("SUPPLIER_LOOKUPS_PER_DAY", "1");
    let calls = 0;
    let input: { keywords?: string[]; maxResults?: number; includeProductDetails?: boolean } = {};
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      calls++;
      input = JSON.parse(String(init?.body));
      return json(RESULTS);
    }));
    const t = convexTest(schema, modules);
    const [brush, other, service] = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const product = (title: string, extra = {}) => ctx.db.insert("products", {
        title, description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z", price: 24.99, ...extra,
      });
      return [await product("Self-cleaning pet brush for dogs and cats"), await product("Another pet brush"), await product("Mobile spa", { isService: true })];
    });

    expect(await t.action(api.aliexpress.findSuppliers, { productId: brush })).toEqual({ skipped: "signed out" });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.action(api.aliexpress.findSuppliers, { productId: service })).toEqual({ skipped: "not a product" });

    const r = await me.action(api.aliexpress.findSuppliers, { productId: brush });
    expect(r).toEqual({ found: 2 });
    expect(input).toMatchObject({ keywords: ["Self cleaning pet brush for dogs and cats"], maxResults: 10, includeProductDetails: false });
    const saved = await t.run((ctx) => ctx.db.get("products", brush));
    expect(saved?.supplierMatches?.map((m) => m.price)).toEqual([2.15, 1.09]);
    expect(saved).toMatchObject({ cost: 5.15, costSource: "aliexpress", costUrl: RESULTS[0].url }); // 2.15 + $3 shipping estimate

    expect(await me.action(api.aliexpress.findSuppliers, { productId: brush })).toEqual({ skipped: "already has suppliers" });
    expect(await me.action(api.aliexpress.findSuppliers, { productId: other })).toEqual({ skipped: "daily limit reached" });
    expect(calls).toBe(1);
  });

  it("doesn't search without an Apify token", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("products", {
        title: "Brush", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z",
      });
    });
    expect(await t.withIdentity({ subject: "u1|s" }).action(api.aliexpress.findSuppliers, { productId })).toEqual({ skipped: "APIFY_TOKEN isn't set" });
  });
});
