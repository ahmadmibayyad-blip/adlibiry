/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { FREE_INSPECTIONS_PER_DAY } from "./storeInspector";
import { matrixProduct, matrixVitalsHtml, matrixVitalsOffers } from "./lib/__fixtures__/storeTeardown";

const modules = import.meta.glob("./**/*.ts");

const homeHtml = `<script src="https://cdn.shopify.com/s/x.js"></script>
<script>Shopify.shop = "eko.myshopify.com"; Shopify.country = "DK";
Shopify.theme = {"name":"Ekohem DK","schema_name":"Cello","schema_version":"3.0.2","theme_store_id":null};</script>
<meta property="og:site_name" content="Ekohemshop DK">
<!-- BEGIN app block: shopify://apps/kaching-bundles/blocks/app-embed-block/1 -->
<a href="/products/bivoks-brodpose">Bread bag</a>`;
const productHtml = `<script src="https://cdn.shopify.com/s/x.js"></script>
<script>Shopify.currency = {"active":"DKK","rate":"1.0"};</script>
<script src="https://cdn.shopify.com/extensions/019f6fd3-453f-7868-9402-ee98143404d9/klarna-on-site-messaging-34/assets/k.js"></script>
<script class="kaching-bundles-deal-block-settings" type="application/json">{"preselectedDealBarId":"b","dealBars":[{"id":"a","title":"Køb 1","quantity":1,"dealBarType":"quantity-break","discountType":"default"},{"id":"b","title":"Køb 2","quantity":2,"badgeText":"Mest populær","dealBarType":"quantity-break","discountType":"percentage","discountValue":10}]}</script>`;

async function setup(plan: "free" | "pro" = "pro") {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...(plan === "pro" ? { plan: "pro", subscriptionStatus: "active" } : {}) }),
  );
  return { t, user: t.withIdentity({ subject: "u1|s" }) };
}

// Domain registration lookups use whois over plain TCP, which fetch stubs can't catch.
process.env.DOMAIN_LOOKUPS = "off";

afterEach(() => vi.unstubAllGlobals());

describe("Store Inspector", () => {
  it("reads the home page and a product page, caches the result and adds the store to the watchlist", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u).replace("://www.", "://"); // the store answers on both
      fetched.push(url);
      if (url.startsWith("https://web.archive.org/cdx/")) return Response.json([["timestamp", "statuscode"], ["20240305101010", "200"]]);
      if (url === "https://ekohemshop.dk/") return new Response(homeHtml);
      if (url === "https://ekohemshop.dk/products/bivoks-brodpose") return new Response(productHtml);
      if (url === "https://ekohemshop.dk/products/bivoks-brodpose.js") return new Response(JSON.stringify({ id: 1, title: "Bivoks brødpose", price: 14900, compare_at_price: 29900, variants: [] }));
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const r = await user.action(api.storeInspector.inspect, { url: "www.ekohemshop.dk" });
    expect(r.host).toBe("ekohemshop.dk");
    expect(r.result.theme).toMatchObject({ schemaName: "Cello", version: "3.0.2" });
    expect(r.result.apps.map((a) => a.name)).toEqual(["Kaching Bundles", "Klarna On-site Messaging"]);
    expect(fetched.filter((u) => !u.includes("web.archive.org"))).toEqual(["https://ekohemshop.dk/", "https://ekohemshop.dk/products/bivoks-brodpose", "https://ekohemshop.dk/products/bivoks-brodpose.js"]);
    // Its age, from the Wayback Machine (asked at the same time as the pages).
    expect(r.result.history).toMatchObject({ months: 1, firstSeen: "2024-03-05" });
    // The main product's teardown: its price from /products/<handle>.js and its bundle tiers.
    expect(r.result.teardown).toMatchObject({
      productPath: "/products/bivoks-brodpose",
      productTitle: "Bivoks brødpose",
      price: { price: 149, compareAt: 299, percentOff: 50, currency: "DKK" },
      bundle: { app: "Kaching Bundles", tiers: [{ title: "Køb 1" }, { title: "Køb 2", badge: "Mest populær", percentOff: 10 }] },
    });

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

  it("fetches a Vitals volume discount from the URL the page's app embed gives", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      fetched.push(url);
      if (url === "https://www.matrix-nutrition.co.uk/products/kong-sleep-aid" || url === "https://www.matrix-nutrition.co.uk/") return new Response(`<script src="https://cdn.shopify.com/s/x.js"></script>${matrixVitalsHtml}`);
      if (url.endsWith("/products/kong-sleep-aid.js")) return new Response(JSON.stringify(matrixProduct));
      if (url.startsWith("https://appsolve.io/")) return new Response(JSON.stringify(matrixVitalsOffers));
      return new Response("", { status: 404 });
    }));
    const { user } = await setup();
    const r = await user.action(api.storeInspector.inspect, { url: "https://www.matrix-nutrition.co.uk/products/kong-sleep-aid" });
    expect(fetched).toContain("https://appsolve.io/bundle/api/v2/sf/ub/pp/56358109371/en/1791838731/GB/7541618114778.json");
    expect(r.result.teardown?.bundle).toMatchObject({ app: "Vitals", tiers: [{ title: "Buy 1" }, { title: "Buy 2 with 15% off", badge: "MOST POPULAR" }, {}, {}] });
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

  it("analyzes an inspected store with AI, from its page and its ads, for its owner only", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    let prompt = "";
    const answer = { verdict: "A buy-1-get-1 store on a free theme.", strengths: [{ point: "Bundles", evidence: "2 Kaching tiers" }], copy: ["Preselect the 2-pack"], beat: ["Real reviews"], weaknesses: ["No reviews shown"], warnings: [], missing: ["Browser-only review widgets"] };
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      prompt = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { t, user } = await setup();
    const inspectionId = await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      const inspectionId = await ctx.db.insert("storeInspections", { userId, host: "komforttid.dk", url: "https://komforttid.dk", inspectedAt: new Date().toISOString(), result: { shopify: true, apps: [], pixels: [], theme: { name: "Refresh", free: true } } });
      await ctx.db.insert("ads", { source: "apify", advertiserName: "Komfort Tid", platform: "Facebook", country: "DK", niche: "Health", headline: "Køb 1 – Få 1 GRATIS (Kun i dag!)", bodyText: "", creativeUrl: "", landingPageUrl: "https://komforttid.dk/products/x", landingHost: "komforttid.dk", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 168, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: new Date().toISOString() });
      await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      return inspectionId;
    });
    const other = t.withIdentity({ subject: "u2|s" });
    const a = await user.action(api.ai.analyzeStore, { inspectionId });
    expect(a).toMatchObject({ verdict: "A buy-1-get-1 store on a free theme.", copy: ["Preselect the 2-pack"] });
    expect(prompt).toContain("Theme: Refresh");
    expect(prompt).toContain("the longest running 168 days");
    expect((await user.query(api.storeInspector.recent, {}))[0].analysis).toMatchObject({ verdict: a.verdict });
    await expect(other.action(api.ai.analyzeStore, { inspectionId })).rejects.toThrow(/Inspect the store first/);
  });
});
