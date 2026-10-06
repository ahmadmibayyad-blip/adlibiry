/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const base = {
  title: "Cool Mat", description: "", imageUrl: "https://cdn.shopify.com/main.jpg", category: "Pet Supplies", tags: [], aiScore: 80,
  saturation: "Low", trend: "Rising", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("product images", () => {
  it("loads Shopify photos once, then waits 7 days", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("products", { ...base, supplierUrl: "https://shop.com/products/cool-mat" }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ images: ["//cdn.shopify.com/main.jpg", "//cdn.shopify.com/2.jpg", "//cdn.shopify.com/3.jpg"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(await t.withIdentity({ subject: "test|s" }).action(api.productImages.load, { productId: id })).toBe(2);
    expect(calls).toEqual(["https://shop.com/products/cool-mat.js"]);
    const p = await t.run((ctx) => ctx.db.get("products", id));
    expect(p?.images).toEqual(["https://cdn.shopify.com/2.jpg", "https://cdn.shopify.com/3.jpg"]);
    expect(await t.withIdentity({ subject: "test|s" }).action(api.productImages.load, { productId: id })).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("falls back to the page's photos and never fetches search links", async () => {
    const t = convexTest(schema, modules);
    const [page, search] = await t.run(async (ctx) => [
      await ctx.db.insert("products", { ...base, supplierUrl: "https://store.example/item/9" }),
      await ctx.db.insert("products", { ...base, supplierUrl: "https://www.aliexpress.com/wholesale?SearchText=mat" }),
    ]);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(`<meta property="og:image" content="https://store.example/a.jpg">`, { status: 200, headers: { "content-type": "text/html" } });
    });
    expect(await t.withIdentity({ subject: "test|s" }).action(api.productImages.load, { productId: page })).toBe(1);
    expect(await t.withIdentity({ subject: "test|s" }).action(api.productImages.load, { productId: search })).toBe(0);
    expect(calls).toEqual(["https://store.example/item/9"]);
  });
});
