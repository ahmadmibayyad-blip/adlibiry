/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const TOKEN = "shpat_" + "a".repeat(32);

afterEach(() => vi.unstubAllGlobals());

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup() {
  const t = convexTest(schema, modules);
  const productId = await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    return ctx.db.insert("products", {
      title: "Dog Cooling Mat", description: "Keeps dogs cool.", imageUrl: "https://cdn.example.com/mat.jpg", price: 34.9, cost: 9.5,
      category: "Pet Supplies", tags: [], aiScore: 80, saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [],
      isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
    });
  });
  return { t, me: t.withIdentity({ subject: "u1|s" }), productId };
}

describe("shopify import", () => {
  it("connects a store, hides the token, and adds a product as a draft", async () => {
    const { me, productId } = await setup();
    const calls: { url: string; headers: Headers; body: { query: string; variables?: { input: { status: string; title: string } } } }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), headers: new Headers(init.headers), body });
      if (body.query.includes("shop {")) return json({ data: { shop: { name: "Paw Shop", myshopifyDomain: "paw-shop.myshopify.com" } } });
      return json({ data: { productSet: { product: { id: "gid://shopify/Product/123", handle: "dog-cooling-mat" }, userErrors: [] } } });
    });

    await expect(me.action(api.shopifyImport.connect, { shopDomain: "paw-shop", accessToken: "abc" })).rejects.toThrow(/shpat_/);
    expect(await me.action(api.shopifyImport.connect, { shopDomain: "Paw-Shop.myshopify.com", accessToken: TOKEN })).toEqual({
      shopName: "Paw Shop", shopDomain: "paw-shop.myshopify.com",
    });
    const conn = await me.query(api.shopifyImport.connection, {});
    expect(conn).toMatchObject({ shopName: "Paw Shop", shopDomain: "paw-shop.myshopify.com" });
    expect(conn).not.toHaveProperty("accessToken");

    expect(await me.action(api.shopifyImport.pushProduct, { productId })).toEqual({ adminUrl: "https://paw-shop.myshopify.com/admin/products/123" });
    const push = calls.find((c) => String(c.body.query).includes("productSet"))!;
    expect(push.url).toMatch(/^https:\/\/paw-shop\.myshopify\.com\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/);
    expect(push.headers.get("X-Shopify-Access-Token")).toBe(TOKEN);
    expect(push.body.query).toContain("productSet(input: $input, synchronous: true)");
    expect(push.body.variables?.input).toMatchObject({ title: "Dog Cooling Mat", status: "DRAFT" });

    await me.mutation(api.shopifyImport.disconnect, {});
    expect(await me.query(api.shopifyImport.connection, {})).toBeNull();
    await expect(me.action(api.shopifyImport.pushProduct, { productId })).rejects.toThrow(/Connect your Shopify store/);
  });

  it("explains Shopify errors", async () => {
    const { me, productId } = await setup();
    vi.stubGlobal("fetch", async () => json({ errors: "Invalid API key or access token" }, 401));
    await expect(me.action(api.shopifyImport.connect, { shopDomain: "paw-shop", accessToken: TOKEN })).rejects.toThrow(/refused the access token/);

    let step = 0;
    vi.stubGlobal("fetch", async () =>
      step++ === 0
        ? json({ data: { shop: { name: "Paw Shop", myshopifyDomain: "paw-shop.myshopify.com" } } })
        : json({ data: { productSet: { product: null, userErrors: [{ field: ["title"], message: "Title is too long" }] } } }),
    );
    await me.action(api.shopifyImport.connect, { shopDomain: "paw-shop", accessToken: TOKEN });
    await expect(me.action(api.shopifyImport.pushProduct, { productId })).rejects.toThrow(/Title is too long/);
  });
});
