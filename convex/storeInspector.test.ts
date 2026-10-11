/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { FREE_INSPECTIONS_PER_DAY } from "./storeInspector";

const modules = import.meta.glob("./**/*.ts");

const homeHtml = `<script src="https://cdn.shopify.com/s/x.js"></script>
<script>Shopify.shop = "eko.myshopify.com"; Shopify.country = "DK";
Shopify.theme = {"name":"Ekohem DK","schema_name":"Cello","schema_version":"3.0.2","theme_store_id":null};</script>
<meta property="og:site_name" content="Ekohemshop DK">
<!-- BEGIN app block: shopify://apps/kaching-bundles/blocks/app-embed-block/1 -->
<a href="/products/bivoks-brodpose">Bread bag</a>`;
const productHtml = `<script src="https://cdn.shopify.com/s/x.js"></script>
<script src="https://cdn.shopify.com/extensions/019f6fd3-453f-7868-9402-ee98143404d9/klarna-on-site-messaging-34/assets/k.js"></script>`;

async function setup(plan: "free" | "pro" = "pro") {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...(plan === "pro" ? { plan: "pro", subscriptionStatus: "active" } : {}) }),
  );
  return { t, user: t.withIdentity({ subject: "u1|s" }) };
}

afterEach(() => vi.unstubAllGlobals());

describe("Store Inspector", () => {
  it("reads the home page and a product page, caches the result and adds the store to the watchlist", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u).replace("://www.", "://"); // the store answers on both
      fetched.push(url);
      if (url === "https://ekohemshop.dk/") return new Response(homeHtml);
      if (url === "https://ekohemshop.dk/products/bivoks-brodpose") return new Response(productHtml);
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const r = await user.action(api.storeInspector.inspect, { url: "www.ekohemshop.dk" });
    expect(r.host).toBe("ekohemshop.dk");
    expect(r.result.theme).toMatchObject({ schemaName: "Cello", version: "3.0.2" });
    expect(r.result.apps.map((a) => a.name)).toEqual(["Kaching Bundles", "Klarna On-site Messaging"]);
    expect(fetched).toEqual(["https://ekohemshop.dk/", "https://ekohemshop.dk/products/bivoks-brodpose"]);

    // Within 12 hours the same store comes from the cache.
    fetched.length = 0;
    await user.action(api.storeInspector.inspect, { url: "https://ekohemshop.dk/products/bivoks-brodpose" });
    expect(fetched).toEqual([]);
    expect(await user.query(api.storeInspector.recent, {})).toMatchObject([{ host: "ekohemshop.dk", tracked: false, storeId: null }]);

    const tracked = await user.mutation(api.storeInspector.track, { inspectionId: r.id });
    expect(tracked.tracked).toBe(true);
    const store = await t.run((ctx) => ctx.db.get("stores", tracked.storeId));
    expect(store).toMatchObject({ name: "Ekohemshop DK", host: "ekohemshop.dk", url: "https://ekohemshop.dk", country: "DK", platform: "Shopify", source: "inspector" });
    expect(await user.query(api.storeInspector.recent, {})).toMatchObject([{ host: "ekohemshop.dk", tracked: true, storeId: tracked.storeId }]);
    // Tracking again keeps the one store and the one watchlist row.
    await user.mutation(api.storeInspector.track, { inspectionId: r.id });
    expect(await t.run(async (ctx) => [(await ctx.db.query("stores").collect()).length, (await ctx.db.query("trackedStores").collect()).length])).toEqual([1, 1]);
  });

  it("explains links that aren't Shopify stores or can't be opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      return url.includes("woo.com") ? new Response("<html>WooCommerce</html>") : new Response("", { status: 500 });
    }));
    const { user } = await setup();
    await expect(user.action(api.storeInspector.inspect, { url: "https://woo.com" })).rejects.toThrow(/doesn't look like a Shopify store/);
    await expect(user.action(api.storeInspector.inspect, { url: "https://down.dk" })).rejects.toThrow(/couldn't open down.dk/);
    await expect(user.action(api.storeInspector.inspect, { url: "http://localhost:3000" })).rejects.toThrow(/Paste a store's address/);
  });

  it("limits free accounts per day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(homeHtml)));
    const { user } = await setup("free");
    for (let i = 0; i < FREE_INSPECTIONS_PER_DAY; i++) await user.action(api.storeInspector.inspect, { url: `https://store${i}.dk` });
    await expect(user.action(api.storeInspector.inspect, { url: "https://one-more.dk" })).rejects.toThrow(/Free accounts can inspect/);
  });
});
