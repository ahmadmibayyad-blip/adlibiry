/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { FREE_SEARCHES_PER_DAY } from "./offerSearch";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup(plan: "free" | "pro" = "pro") {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...(plan === "pro" ? { plan: "pro", subscriptionStatus: "active" } : {}) }),
  );
  return { t, user: t.withIdentity({ subject: "u1|s" }) };
}

const DAY = 86_400_000;
const items = [
  { ad_archive_id: "1", page_id: "77", page_name: "PawTech", start_date: (Date.now() - 30 * DAY) / 1000, collation_count: 3, snapshot: { body: { text: "Køb 2 få 1 gratis 🐾" }, link_url: "https://pawtech.dk/products/seat" } },
  { ad_archive_id: "2", page_name: "PawTech", start_date: (Date.now() - 5 * DAY) / 1000, snapshot: { body: { text: "Gratis fragt" }, link_url: "https://www.pawtech.dk/" } },
  { ad_archive_id: "3", page_name: "Helysta", start_date: (Date.now() - 60 * DAY) / 1000, snapshot: { body: { text: "Køb 1 få 1 gratis" }, link_url: "https://helysta.dk/products/pude" } },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Offer Search", () => {
  it("searches the offer in Danish through Apify, groups the ads by store, and answers the same search from the last one", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    const runInputs: { urls: { url: string }[]; limitPerSource: number }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/")) {
        runInputs.push(JSON.parse(String(init?.body)));
        return json({ data: { id: "run1", status: "RUNNING" } });
      }
      if (url.includes("/datasets/ds1/items")) return json(items);
      if (url.includes("/actor-runs/run1")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.05 } });
      if (url === "https://pawtech.dk/meta.json") return json({ myshopify_domain: "pawtech.myshopify.com", currency: "DKK", country: "DK", published_products_count: 7 });
      if (url === "https://pawtech.dk/") return new Response('<script src="https://loox.io/widget/abc/loox.js"></script>', { headers: { "content-type": "text/html" } });
      if (url === "https://pawtech.dk/products.json?limit=250") {
        return json({
          products: Array.from({ length: 7 }, (_, i) => ({
            id: i, product_type: "Pet", title: i === 0 ? "Hundesæde™" : `Pet ${i}`, vendor: i === 1 ? "Mijn winkel" : "PawTech",
            variants: [{ price: "99", compare_at_price: i < 6 ? "199" : null }],
          })),
        });
      }
      if (url === "https://pawtech.dk/products/seat.json") return json({ product: { title: "Hundesæde", variants: [{ price: "299.00", compare_at_price: "499.00" }], image: { src: "https://cdn.shopify.com/seat.jpg" } } });
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const { id, cached } = await user.action(api.offerSearch.start, { offer: "bxgy", country: "DK" });
    expect(cached).toBe(false);
    // The three Danish phrases, as exact phrases, in one run.
    expect(runInputs[0].urls.map((x) => decodeURIComponent(x.url))).toEqual([
      expect.stringContaining('q="1+1+gratis"&search_type=keyword_exact_phrase'),
      expect.stringContaining('q="2+1+gratis"'),
      expect.stringContaining('q="køb+2+få+1+gratis"'),
    ]);
    expect(runInputs[0].limitPerSource).toBe(50);
    expect(await user.query(api.offerSearch.get, { id })).toMatchObject({ status: "running", country: "DK" });

    // Apify calls the webhook when the run is done.
    const run = await t.run(async (ctx) => (await ctx.db.query("apifyRuns").collect())[0]);
    expect(run).toMatchObject({ trigger: "offer", country: "DK" });
    await t.action(internal.apify.handleWebhook, { token: run.token, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    const done = await user.query(api.offerSearch.get, { id });
    // The "Gratis fragt" ad doesn't show the offer searched for, so it's left out.
    expect(done).toMatchObject({ status: "done", adsFound: 2 });
    expect(done!.stores.map((s) => [s.host, s.ads, s.shopify])).toEqual([
      ["pawtech.dk", 1, true],
      ["helysta.dk", 1, false],
    ]);
    expect(done!.stores[0].offers.map((o) => o.label)).toEqual(["Buy 2 get 1"]);
    // Each store is typed from its catalogue, its apps and its offer: a hero store.
    expect(done!.stores[0]).toMatchObject({ catalogue: 7, productTypes: 1, onSaleShare: 0.86, tmShare: 0.14, defaultVendor: true, apps: ["Loox"] });
    expect(done!.stores[0].dropship).toEqual({
      score: 4, likely: true, type: "hero", reasons: ["7 products", "1 type", "86% on sale", "Loox", "default vendor", "−40%"],
    });
    expect(done!.stores[1].dropship).toEqual({ score: 0, likely: false, type: "brand", reasons: [] });
    // The Shopify store's currency and the product its ads link to, read from the store itself.
    expect(done!.stores[0]).toMatchObject({
      currency: "DKK",
      storeCountry: "DK",
      products: [{ handle: "seat", title: "Hundesæde", price: 299, compareAt: 499, url: "https://pawtech.dk/products/seat", image: "https://cdn.shopify.com/seat.jpg" }],
    });
    expect(done!.stores[1]).not.toHaveProperty("products");
    // The ads also land in Ad Spy, tied to their store right away (Store Inspector's AI reads them).
    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads).toHaveLength(3);
    expect(ads.map((a) => a.landingHost).sort()).toEqual(["helysta.dk", "pawtech.dk", "pawtech.dk"]);

    // The same search again: answered from the last one, no new run, and it doesn't count against the limit.
    const again = await user.action(api.offerSearch.start, { offer: "bxgy", country: "dk" });
    expect(again.cached).toBe(true);
    expect(runInputs.filter((r) => r.urls)).toHaveLength(1); // no new Ad Library run (the picture search is separate)
    expect(await user.query(api.offerSearch.get, { id: again.id })).toMatchObject({ status: "done", adsFound: 2 });
    expect(await user.query(api.offerSearch.recent, {})).toMatchObject({ used: 1 });
  });

  it("finishes from Apify itself when the webhook doesn't come, and keeps free accounts to their daily searches", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    let runs = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/")) return json({ data: { id: `run${++runs}`, status: "RUNNING" } });
      if (url.includes("/actor-runs/run1")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds1" } });
      // A free-shipping search keeps the free-shipping ad, not the "buy 1 get 1" one.
      if (url.includes("/datasets/ds1/items")) return json(items.slice(1));
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup("free");
    const first = await user.action(api.offerSearch.start, { offer: "free_shipping", country: "SE" });
    const token = (await t.run(async (ctx) => (await ctx.db.get("offerSearches", first.id))!.runToken))!;
    await t.action(internal.offerSearch.checkRun, { runToken: token, attempt: 1 });
    expect(await user.query(api.offerSearch.get, { id: first.id })).toMatchObject({ status: "done", adsFound: 1 });

    for (let i = 1; i < FREE_SEARCHES_PER_DAY; i++) await user.action(api.offerSearch.start, { offer: "free_shipping", country: "SE", extra: `ord${i}` });
    await expect(user.action(api.offerSearch.start, { offer: "percent", country: "NO" })).rejects.toThrow(/Free accounts get 3 offer searches a day/);
    await expect(user.action(api.offerSearch.start, { country: "XX", offer: "bxgy" })).rejects.toThrow(/listed countries/);
  });

  it("says so when the Apify account has reached its monthly limit", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" } }, 403)));
    const { user } = await setup();
    const { id } = await user.action(api.offerSearch.start, { offer: "bxgy", country: "DK" });
    expect(await user.query(api.offerSearch.get, { id })).toMatchObject({ status: "failed", error: expect.stringContaining("this month's search credit") });
  });
});

describe("Offer research (Admin)", () => {
  it("runs every offer in every country once a day, within the Apify budget, and shows the results to admins", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    vi.stubEnv("OFFER_RESEARCH_ADS", "160");
    const runInputs: { urls: { url: string }[]; count: number }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/")) {
        runInputs.push(JSON.parse(String(init?.body)));
        return json({ data: { id: `run${runInputs.length}`, status: "RUNNING" } });
      }
      if (url.includes("/datasets/ds1/items")) return json(items);
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" }));
    const admin = t.withIdentity({ subject: "admin1|s" });

    const result = await t.action(internal.offerSearch.dailyResearch, {});
    // 16 countries × 10 ads (160 shared out), each run every offer's main phrase in the country's language.
    expect(result).toEqual({ started: 16, ads: 160, errors: [] });
    expect(runInputs.every((r) => r.count === 10 && r.urls.length === 5)).toBe(true);

    // Denmark's run finishes; the others are still running.
    const dk = await t.run(async (ctx) => (await ctx.db.query("offerSearches").collect()).find((r) => r.country === "DK")!);
    await t.action(internal.apify.handleWebhook, { token: dk.runToken!, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    const view = await admin.query(api.offerSearch.research, {});
    expect(view.days).toHaveLength(1);
    expect(view.countries).toHaveLength(16);
    const denmark = view.countries.find((c) => c.country === "DK")!;
    expect(denmark).toMatchObject({ status: "done", adsFound: 3 });
    expect(denmark.stores.map((s) => [s.host, s.country])).toEqual([
      ["pawtech.dk", "DK"],
      ["helysta.dk", "DK"],
    ]);
    expect(view.countries.find((c) => c.country === "SE")).toMatchObject({ status: "running" });
    // Daily rows belong to no one: they don't count against anyone's searches.
    expect(await user.query(api.offerSearch.recent, {})).toMatchObject({ used: 0, searches: [] });
    await expect(user.query(api.offerSearch.research, {})).rejects.toThrow();
  });

  it("stops at the Apify daily budget and can be switched off", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    vi.stubEnv("APIFY_DAILY_BUDGET_USD", "0.11");
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { id: "run", status: "RUNNING" } })));
    const { t } = await setup();
    const result = await t.action(internal.offerSearch.dailyResearch, {});
    // Each run reserves its cap (63 ads ≈ $0.08), so only one fits in $0.11.
    expect(result).toMatchObject({ started: 1, errors: [expect.stringContaining("budget is used up")] });
    // The Apify account's monthly limit stops every country alike: one message, no more tries.
    vi.stubEnv("APIFY_DAILY_BUDGET_USD", "10");
    const tries = vi.fn(async () => json({ error: { type: "platform-feature-disabled", message: "Monthly usage hard limit exceeded" } }, 403));
    vi.stubGlobal("fetch", tries);
    const limited = await t.action(internal.offerSearch.dailyResearch, {});
    expect(limited).toEqual({ started: 0, ads: 0, errors: [expect.stringContaining("monthly usage limit")] });
    expect(tries).toHaveBeenCalledTimes(1);
    vi.stubEnv("OFFER_RESEARCH_ADS", "off");
    expect(await t.action(internal.offerSearch.dailyResearch, {})).toEqual({ notConfigured: "OFFER_RESEARCH_ADS is off" });
  });
});

describe("Offer Search sourcing proof", () => {
  // One hero store (pawtech.dk) with a product photo; Apify's picture search finds it on AliExpress.
  async function searchWithPictures(pictureRows: unknown[]) {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    const pictureCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/") && url.includes("reverse-image-search")) {
        pictureCalls.push(JSON.parse(String(init?.body)).imageUrl);
        return json(pictureRows);
      }
      if (url.includes("api.apify.com/v2/acts/")) return json({ data: { id: "run1", status: "RUNNING" } });
      if (url.includes("/datasets/ds1/items")) return json(items.slice(0, 1));
      if (url === "https://pawtech.dk/meta.json") return json({ myshopify_domain: "pawtech.myshopify.com", currency: "DKK", country: "DK", published_products_count: 7 });
      if (url === "https://pawtech.dk/products.json?limit=250") return json({ products: Array.from({ length: 7 }, (_, i) => ({ id: i, product_type: "Pet", variants: [{ price: "99", compare_at_price: "199" }] })) });
      if (url === "https://pawtech.dk/products/seat.json") return json({ product: { title: "Hundesæde", variants: [{ price: "299.00", compare_at_price: "499.00" }], image: { src: "https://cdn.shopify.com/seat.jpg" } } });
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const { id } = await user.action(api.offerSearch.start, { offer: "bxgy", country: "DK" });
    const run = await t.run(async (ctx) => (await ctx.db.query("apifyRuns").collect())[0]);
    await t.action(internal.apify.handleWebhook, { token: run.token, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    return { t, user, done: (await user.query(api.offerSearch.get, { id }))!, pictureCalls };
  }

  it("matches the hero product on AliExpress and shows the markup", async () => {
    const { done, pictureCalls } = await searchWithPictures([
      { site: "aliexpress", title: "Dog car seat hammock waterproof", price: 12, currency: "USD", productUrl: "https://www.aliexpress.com/item/2.html" },
      { site: "aliexpress", title: "Dog car seat hammock", price: 9.5, currency: "USD", productUrl: "https://www.aliexpress.com/item/1.html?spm=x" },
    ]);
    expect(pictureCalls).toEqual(["https://cdn.shopify.com/seat.jpg"]);
    const sourcing = done.stores[0].products![0].sourcing!;
    expect(sourcing).toMatchObject({ price: 9.5, url: "https://www.aliexpress.com/item/1.html", title: "Dog car seat hammock" });
    // 299 DKK in USD (about 43-47) ÷ 9.50, never the raw 299 ÷ 9.5.
    expect(sourcing.markup).toBeGreaterThan(4);
    expect(sourcing.markup).toBeLessThan(5.2);
    expect(done.stores[0].dropship!.reasons).toContain(`On AliExpress ×${sourcing.markup}`);
  });

  it("finishes without sourcing once the day's picture searches are used up", async () => {
    vi.stubEnv("PICTURE_LOOKUPS_PER_DAY", "0");
    const { done, pictureCalls } = await searchWithPictures([{ site: "aliexpress", title: "x", price: 1, currency: "USD", productUrl: "https://www.aliexpress.com/item/1.html" }]);
    expect(pictureCalls).toEqual([]);
    expect(done).toMatchObject({ status: "done" });
    expect(done.stores[0].products![0]).not.toHaveProperty("sourcing");
  });

  it("leaves a product without a match as it is", async () => {
    const { done } = await searchWithPictures([]);
    expect(done.stores[0].products![0]).not.toHaveProperty("sourcing");
  });
});

describe("Offer Search store actions", () => {
  it("adds a found store to AdSpy once, to track it or put it in a collection", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { t, user } = await setup();
    expect(await user.query(api.offerSearch.storeStates, { hosts: ["pawtech.dk"] })).toEqual([]);
    const id = await user.mutation(api.offerSearch.ensureStore, { host: "pawtech.dk", name: "PawTech", shopify: true, country: "DK" });
    expect(await user.mutation(api.offerSearch.ensureStore, { host: "pawtech.dk" })).toBe(id);
    expect(await t.run((ctx) => ctx.db.get("stores", id))).toMatchObject({ name: "PawTech", host: "pawtech.dk", platform: "Shopify", country: "DK", source: "offerSearch" });
    await user.mutation(api.stores.toggleTrackStore, { storeId: id });
    expect(await user.query(api.offerSearch.storeStates, { hosts: ["pawtech.dk", "helysta.dk"] })).toEqual([{ host: "pawtech.dk", storeId: id, tracked: true }]);
    await expect(user.mutation(api.offerSearch.ensureStore, { host: "not a store" })).rejects.toThrow(/store address/);
    // Tracking schedules a sales check (storeSales.checkOne); it must finish here, or its fetches land in the next test's stub.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(left.filter((j) => j.state.kind === "pending" || j.state.kind === "inProgress").map((j) => j.name)).toEqual([]);
  });

  it("finds the product on AliExpress by its photo", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      expect(String(u)).toContain("run-sync-get-dataset-items");
      return json([
        { site: "aliexpress", title: "Pet car seat cover", price: 12.5, currency: "USD", productUrl: "https://www.aliexpress.com/item/100.html?spm=x", imageUrl: "https://ae/1.jpg" },
        { site: "1688", title: "Other site", price: 3, currency: "USD", productUrl: "https://detail.1688.com/1.html" },
      ]);
    }));
    const { user } = await setup();
    const r = await user.action(api.offerSearch.aliexpressFor, { imageUrl: "https://cdn.shopify.com/seat.jpg" });
    expect(r).toEqual({ matches: [expect.objectContaining({ title: "Pet car seat cover", price: 12.5, url: "https://www.aliexpress.com/item/100.html" })] });
    expect(JSON.parse(bodies[0])).toMatchObject({ imageUrl: "https://cdn.shopify.com/seat.jpg", destination: "aliexpress" });
    expect(await user.action(api.offerSearch.aliexpressFor, { imageUrl: "not-a-url" })).toEqual({ skipped: expect.stringContaining("no photo") });
  });
});
