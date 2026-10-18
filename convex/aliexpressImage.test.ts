/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { fromPictureSearch, isAccessoryOf } from "./lib/aliexpress";

const modules = import.meta.glob("./**/*.ts");

// Rows as the reverse-image actor returned them for a portable blender photo (2026-10).
const ROWS = [
  {
    site: "aliexpress", title: "Portable USB Rechargeable Electric Blender Gym Office", price: 19.55, currency: "USD",
    productUrl: "https://www.aliexpress.com/item/1005012039762746.html", imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg_250x250.jpg",
    tradeCount: null,
  },
  {
    site: "aliexpress", title: "Portable blender with 20oz cup, USB-C rechargeable", price: 20.15, currency: "USD",
    productUrl: "https://www.aliexpress.com/item/1005011829105153.html?spm=x", imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/b.jpg", tradeCount: 66,
  },
  { site: "aliexpress", title: "Blender blade spare part", price: 1.2, currency: "USD", productUrl: "https://www.aliexpress.com/item/1.html", tradeCount: 3 },
  { site: "alibaba", title: "Wholesale blender", price: 5, currency: "USD", productUrl: "https://www.alibaba.com/product/2.html" },
  { site: "aliexpress", title: "Duplicate", price: 20.15, currency: "USD", productUrl: "https://www.aliexpress.com/item/1005011829105153.html" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fromPictureSearch", () => {
  it("keeps AliExpress listings in order, without parts or repeats", () => {
    expect(fromPictureSearch(ROWS, { price: 39.99 })).toEqual([
      { title: "Portable USB Rechargeable Electric Blender Gym Office", price: 19.55, url: "https://www.aliexpress.com/item/1005012039762746.html", imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg_250x250.jpg" },
      { title: "Portable blender with 20oz cup, USB-C rechargeable", price: 20.15, url: "https://www.aliexpress.com/item/1005011829105153.html", imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/b.jpg", orders: 66 },
    ]);
    // Without a product price the part stays in.
    expect(fromPictureSearch(ROWS).map((m) => m.price)).toEqual([19.55, 20.15, 1.2]);
    expect(fromPictureSearch(null)).toEqual([]);
  });

  it("drops accessories the product itself isn't", () => {
    const title = "Veken Stainless Steel Cat Water Fountain 108oz C1";
    expect(isAccessoryOf(title, "12 Pack Cat Water Fountain Sponge Filter")).toBe(true);
    expect(isAccessoryOf(title, "2.2L Automatic Cat Water Fountain Stainless Steel")).toBe(false);
    expect(isAccessoryOf("Replacement Filters for Cat Fountain, 8 Pack", "Cat Fountain Replacement Filter 6pcs")).toBe(false);
    const rows = [{ site: "aliexpress", title: "12 Pack Cat Water Fountain Sponge", price: 9, currency: "USD", productUrl: "https://www.aliexpress.com/item/9.html" }];
    expect(fromPictureSearch(rows, { price: 27.5, title })).toEqual([]);
  });
});

describe("findByPicture", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("products", {
        title: "Portable Blender", description: "", imageUrl: "https://cdn.shopify.com/blender.png", category: "Kitchen", tags: [], aiScore: 50,
        saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z", price: 39.99,
      });
    });
    return { t, productId, me: t.withIdentity({ subject: "u1|s" }) };
  }

  it("searches once with the product photo and saves the matches for everyone", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("/acts/dev00~alibaba-1688-aliexpress-reverse-image-search-api/run-sync-get-dataset-items");
      expect(JSON.parse(String(init.body))).toMatchObject({ imageUrl: "https://cdn.shopify.com/blender.png", destination: "aliexpress" });
      return new Response(JSON.stringify(ROWS), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { t, productId, me } = await setup();
    expect(await me.action(api.aliexpressImage.findByPicture, { productId })).toEqual({ found: 2 });
    const p = await t.run((ctx) => ctx.db.get("products", productId));
    expect(p?.pictureMatches?.map((m) => m.price)).toEqual([19.55, 20.15]);
    expect(await me.action(api.aliexpressImage.findByPicture, { productId })).toEqual({ skipped: "searched recently" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily limit and when signed out", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    vi.stubEnv("PICTURE_LOOKUPS_PER_DAY", "0");
    const { t, productId, me } = await setup();
    expect(await me.action(api.aliexpressImage.findByPicture, { productId })).toEqual({ skipped: "daily limit reached" });
    expect(await t.action(api.aliexpressImage.findByPicture, { productId })).toEqual({ skipped: "signed out" });
  });
});
