/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
    await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user", plan: "pro", subscriptionStatus: "active" });
    await ctx.db.insert("shopifyConnections", { userId, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z" });
  });
  return { t, user: t.withIdentity({ subject: "u1|s" }), other: t.withIdentity({ subject: "u2|s" }) };
}

describe("Launch from a link", () => {
  it("reads a Shopify store's product into a private product the user can launch", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    let productSet: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url === "https://pets-dreams.uk/products/snufflemaster.js") {
        return json({ title: "SnuffleMaster snuffle mat", description: "<p>Hide treats in the mat.</p>", price: 2999, images: ["//cdn.shopify.com/s/a.jpg"] });
      }
      if (url === "https://pets-dreams.uk/cart.js") return json({ currency: "USD" });
      if (url.includes("anthropic.com")) {
        const copy = {
          title: "SnuffleMaster", subtitle: "Sniff and play", benefits: ["Keeps dogs busy"], hook: "Bored dog?", howItWorks: ["Hide treats"], whatsIncluded: ["1 mat"],
          faq: [], shippingReturns: "", seo: { title: "SnuffleMaster", description: "Snuffle mat" }, adKit: [], checks: [],
        };
        return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(copy) }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      if (url.includes("/graphql.json")) {
        productSet = JSON.parse(String(init?.body)).variables.input;
        return json({ data: { productSet: { product: { id: "gid://shopify/Product/5", handle: "snufflemaster" }, userErrors: [] } } });
      }
      return new Response("", { status: 404 });
    }));
    const { t, user, other } = await setup();

    const imported = await user.action(api.productImport.importLink, { url: "https://pets-dreams.uk/collections/dogs/products/snufflemaster?variant=1#top" });
    expect(imported).toMatchObject({ title: "SnuffleMaster snuffle mat", imageUrl: "https://cdn.shopify.com/s/a.jpg" });
    // Pasting the same link again updates the same product.
    expect((await user.action(api.productImport.importLink, { url: "https://pets-dreams.uk/collections/dogs/products/snufflemaster?variant=1" })).productId).toBe(imported.productId);
    // It never reaches the shared catalog.
    expect(await t.run((ctx) => ctx.db.query("products").collect())).toHaveLength(0);

    const prep = await user.query(api.launch.prepare, { productId: imported.productId });
    expect(prep).toMatchObject({ imported: true, blocked: null, suggested: { price: 29.99 } });
    const { launchId } = await user.mutation(api.launch.start, { productId: imported.productId, language: "English", tone: "friendly", publish: "DRAFT" });
    await settle(t);
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({ status: "published", shopifyProductId: "gid://shopify/Product/5" });
    expect(productSet).toMatchObject({ title: "SnuffleMaster", files: [{ originalSource: "https://cdn.shopify.com/s/a.jpg" }] });
    expect((await user.query(api.launch.mine, {}))[0].product).toMatchObject({ title: "SnuffleMaster snuffle mat", imported: true });

    // Someone else can't see or launch it.
    expect(await other.query(api.launch.prepare, { productId: imported.productId })).toBeNull();
    await expect(other.mutation(api.launch.start, { productId: imported.productId, language: "English", tone: "friendly", publish: "DRAFT" })).rejects.toThrow(/not found/);
  });

  it("reads AliExpress through the Apify reader when AliExpress shows the server a bot check", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    let apifyBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.startsWith("https://www.aliexpress.com/item/")) return new Response("<html><title>Verify</title><div id=baxia-punish></div></html>", { status: 200 });
      if (url.startsWith("https://api.apify.com/v2/acts/zen-studio~aliexpress-scraper/run-sync-get-dataset-items")) {
        apifyBody = JSON.parse(String(init?.body));
        return json([{ title: "New Pet Dog Brush Cat Comb", price: 1.09, currency: "USD", gallery: ["https://ae/1.jpg", "https://ae/2.jpg"] }]);
      }
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const r = await user.action(api.productImport.importLink, { url: "https://www.aliexpress.com/item/1005012573349832.html?spm=x" });
    expect(r).toMatchObject({ title: "New Pet Dog Brush Cat Comb", imageUrl: "https://ae/1.jpg" });
    expect(apifyBody).toMatchObject({ productUrls: ["https://www.aliexpress.com/item/1005012573349832.html"], maxResults: 1 });
    const saved = await t.run((ctx) => ctx.db.get("importedProducts", r.productId));
    expect(saved).toMatchObject({ source: "aliexpress", cost: 4.09, images: ["https://ae/2.jpg"] }); // $1.09 + $3 shipping estimate
  });

  it("explains links it can't use", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><p>Just a blog</p></html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    const { user } = await setup();
    await expect(user.action(api.productImport.importLink, { url: "not a link" })).rejects.toThrow(/starting with https/);
    await expect(user.action(api.productImport.importLink, { url: "https://blog.example.com/post" })).rejects.toThrow(/couldn't read a product/);
  });
});
