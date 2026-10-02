/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "US",
  niche: "Pet Supplies",
  headline: "Keep your dog cool",
  bodyText: "No water, no power.",
  creativeUrl: "https://cdn.example.com/a.jpg",
  landingPageUrl: "https://paws.example.com/products/dog-cooling-mat",
  spendEstimate: "$1K–$5K",
  likes: 100,
  views: "10.0K",
  daysRunning: 10,
  aiScore: 70,
  targeting: { ageRange: "18-65", gender: "All", interests: [] },
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  source: "apify",
  ...over,
});

type NewProduct = Omit<Doc<"products">, "_id" | "_creationTime">;
const product = (over: Partial<NewProduct>): NewProduct => ({
  title: "Thing",
  description: "",
  imageUrl: "https://cdn.example.com/p.jpg",
  category: "Home & Living",
  tags: [],
  aiScore: 70,
  saturation: "Unknown",
  trend: "Unknown",
  supplierUrl: "",
  adExamples: [],
  isWinnerOfDay: false,
  publishedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

async function runPipeline(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.productPipeline.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return await t.query(api.productPipeline.status, {});
}

// Product pages "served" to the price lookup; everything else has no price.
let pages: Record<string, string> = {};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T08:05:00Z"));
  pages = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(pages[url] ?? "<html></html>", { headers: { "content-type": "text/html" } })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("linking ads to products", () => {
  it("merges ads for the same product and skips ads that don't sell one", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => [
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://paws.example.com/products/dog-cooling-mat?utm_source=fb", views: "5.5M", likes: 18947, comments: 464, bodyText: "GMV $235K" })),
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://www.paws.example.com/collections/sale/products/dog-cooling-mat", views: "485.8K", likes: 2846, aiScore: 82 })),
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://paws.example.com/" })), // home page
      await ctx.db.insert("ads", ad({ headline: "Gift cards for dog lovers", landingPageUrl: "https://paws.example.com/products/gift-card" })),
    ]);
    const status = await runPipeline(t);
    expect(status?.state).toBe("done");

    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p).toMatchObject({ title: "Dog Cooling Mat", source: "ads", linkedAds: 2, category: "Pet Supplies" });
    expect(p.linkedViews).toBe(5_500_000 + 485_800);
    expect(p.likes).toBe(18947 + 2846);
    expect(p.linkedGmv).toBe(235_000);
    expect(p.aiScore).toBe(85); // best ad 82 + 3 for a second ad

    const linked = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get("ads", id))));
    expect(linked.map((a) => a?.productId ?? null)).toEqual([p._id, p._id, null, null]);

    // Running again changes nothing.
    await runPipeline(t);
    expect(await t.run((ctx) => ctx.db.query("products").collect())).toHaveLength(1);
  });

  it("attaches ads to an existing product with the same landing page", async () => {
    const t = convexTest(schema, modules);
    const pid = await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({}));
      return await ctx.db.insert("products", product({ title: "Cooling Mat", storeUrl: "https://paws.example.com/products/dog-cooling-mat", source: "csv_import" }));
    });
    await runPipeline(t);
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products).toHaveLength(1);
    expect(products[0]._id).toBe(pid);
    expect(products[0].linkedAds).toBe(1);
    expect(products[0].title).toBe("Cooling Mat"); // product DB data is kept
  });
});

describe("Winning Products", () => {
  it("keeps the top 50 per niche with score 65+, excludes flagged items and mixes niches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) await ctx.db.insert("products", product({ title: `Home thing ${i}`, category: "Home & Living", aiScore: 99 - (i % 30) }));
      for (let i = 0; i < 3; i++) await ctx.db.insert("products", product({ title: `Pet thing ${i}`, category: "Pet Supplies", aiScore: 90 - i }));
      await ctx.db.insert("products", product({ title: "Sporty thing", category: "Sports", aiScore: 80 }));
      await ctx.db.insert("products", product({ title: "Weak thing", category: "Sports", aiScore: 64 }));
      await ctx.db.insert("products", product({ title: "Personalized name necklace", category: "Jewelry", aiScore: 95 }));
    });
    await runPipeline(t);

    const summary = await t.query(api.winners.summary, {});
    expect(summary.total).toBe(50 + 3 + 1);
    expect(Object.fromEntries(summary.perNiche.map((n) => [n.niche, n.filled]))).toEqual({ "Home & Living": 50, "Pet Supplies": 3, Sports: 1 });

    const feed = await t.query(api.winners.feed, { paginationOpts: { numItems: 10, cursor: null } });
    const niches = feed.page.map((r) => r.niche);
    // Home & Living has the best product, so it leads; then the niches alternate.
    expect(niches.slice(0, 7)).toEqual(["Home & Living", "Pet Supplies", "Sports", "Home & Living", "Pet Supplies", "Home & Living", "Pet Supplies"]);
    expect(feed.page[0]).toMatchObject({ nicheRank: 1, isNewToday: true });
    expect(feed.page[0].product.winnerRank).toBe(1);

    // Next day: still a winner, no longer "new today".
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    const again = await t.query(api.winners.feed, { paginationOpts: { numItems: 1, cursor: null } });
    expect(again.page[0].isNewToday).toBe(false);
  });

  it("clears the rank of products that drop out", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("products", product({ aiScore: 80 })));
    await runPipeline(t);
    expect((await t.run((ctx) => ctx.db.get("products", id)))?.winnerRank).toBe(1);
    await t.run((ctx) => ctx.db.patch("products", id, { aiScore: 50 }));
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    expect((await t.run((ctx) => ctx.db.get("products", id)))?.winnerRank).toBeUndefined();
    expect((await t.query(api.winners.summary, {})).total).toBe(0);
  });
});

describe("daily history", () => {
  it("saves one row per product and ad per day and prunes after 90 days", async () => {
    const t = convexTest(schema, modules);
    const adId = await t.run(async (ctx) => {
      await ctx.db.insert("dailySnapshots", {
        day: "2026-06-01", kind: "ad", entityId: "old", score: 1, adsRunning: 1, views: 1, likes: 0, comments: 0, spend: 0, gmv: 0,
      });
      return await ctx.db.insert("ads", ad({ views: "10.0K", likes: 50, comments: 5, spendEstimate: "$1K–$5K" }));
    });
    await runPipeline(t);
    await runPipeline(t); // same day twice: still one row each

    const rows = await t.run((ctx) => ctx.db.query("dailySnapshots").collect());
    expect(rows.map((r) => r.day)).toEqual(["2026-09-30", "2026-09-30"]);
    const adRow = rows.find((r) => r.kind === "ad")!;
    expect(adRow).toMatchObject({ entityId: adId, views: 10_000, likes: 50, comments: 5, spend: 5_000 });
    const productRow = rows.find((r) => r.kind === "product")!;
    expect(productRow).toMatchObject({ views: 10_000, likes: 50, adsRunning: 1 });

    const history = await t.query(api.history.adHistory, { adId: adId as Id<"ads">, days: 7 });
    expect(history).toHaveLength(1);
  });

  it("gives products from ads a trend once there is a week of history", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("ads", ad({ views: "10.0K" })));
    await runPipeline(t);
    const [p] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(p.trend).toBe("Unknown");

    vi.setSystemTime(new Date("2026-10-07T08:05:00Z"));
    await t.run(async (ctx) => {
      const [a] = await ctx.db.query("ads").collect();
      await ctx.db.patch("ads", a._id, { views: "20.0K" });
    });
    await runPipeline(t);
    const [after] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(after.trend).toBe("Rising");
    expect(after.growthPercent).toBe(100);
  });
});

describe("admin", () => {
  it("only admins can start a run", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
    });
    await expect(t.withIdentity({ subject: "u1|s" }).mutation(api.productPipeline.runNow, {})).rejects.toThrow();
    expect(await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.runNow, {})).toEqual({ started: true });
    // A second click while it runs doesn't start another run.
    expect(await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.runNow, {})).toEqual({ started: false });
  });
});

describe("Products filters", () => {
  it("filters by several niches, origin and hide flags, and sorts by margin", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({}));
      await ctx.db.insert("products", product({ title: "Cheap lamp", category: "Home & Living", price: 20, cost: 15 }));
      await ctx.db.insert("products", product({ title: "Fancy lamp", category: "Home & Living", price: 40, cost: 8 }));
      await ctx.db.insert("products", product({ title: "Personalized mug", category: "Home & Living" }));
      await ctx.db.insert("products", product({ title: "Ball", category: "Sports" }));
    });
    await runPipeline(t);
    const list = async (args: Record<string, unknown>) =>
      (await t.query(api.products.list, { paginationOpts: { numItems: 50, cursor: null }, ...args })).page.map((p) => p.title).sort();

    expect(await list({ categories: ["Pet Supplies", "Sports"] })).toEqual(["Ball", "Dog Cooling Mat"]);
    expect(await list({ origin: "ads" })).toEqual(["Dog Cooling Mat"]);
    expect(await list({ origin: "db", hidePersonalised: true })).toEqual(["Ball", "Cheap lamp", "Fancy lamp"]);
    const byMargin = (await t.query(api.products.list, { paginationOpts: { numItems: 2, cursor: null }, sort: "margin" })).page.map((p) => p.title);
    expect(byMargin).toEqual(["Fancy lamp", "Cheap lamp"]);
  });
});

describe("prices for products found in ads", () => {
  it("takes the price an import wrote into the ad text", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("ads", ad({ bodyText: "Product Price: $12.61 · Items Sold (Last 7 days): 14" })));
    await runPipeline(t);
    const [p] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(p).toMatchObject({ price: 12.61, priceSource: "ad_data", originalPrice: "USD 12.61" });
  });

  it("reads the price from the product page, converting to USD", async () => {
    const t = convexTest(schema, modules);
    pages["https://paws.example.com/products/dog-cooling-mat"] =
      '<html><head><meta property="og:price:amount" content="299,00"><meta property="og:price:currency" content="DKK"></head></html>';
    await t.run((ctx) => ctx.db.insert("ads", ad({})));
    await runPipeline(t);
    const [p] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(p).toMatchObject({ price: 43.36, priceSource: "landing_page", originalPrice: "DKK 299.00" });
    expect(p.priceCheckedAt).toBeDefined();
  });

  it("doesn't re-check a page without a price for a week", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("ads", ad({})));
    await runPipeline(t);
    const calls = vi.mocked(fetch).mock.calls.length;
    await runPipeline(t);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });
});

describe("Research tab", () => {
  it("replaces demo trends and niches with ones built from ads and products", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("niches", { name: "Fake", icon: "Package", description: "demo", avgAiScore: 99, productCount: 999, trendDirection: "Rising", topCountries: [] });
      for (let i = 0; i < 4; i++) {
        await ctx.db.insert("ads", ad({ firstSeenAt: "2026-09-28T00:00:00.000Z", landingPageUrl: `https://paws.example.com/products/dog-cooling-mat-${i}` }));
      }
    });
    await runPipeline(t);
    const niches = await t.run((ctx) => ctx.db.query("niches").collect());
    expect(niches.map((n) => n.name)).toEqual(["Pet Supplies"]);
    expect(niches[0].productCount).toBe(1); // the four ads are the same product
    const trends = await t.query(api.trends.list, {});
    expect(trends.map((r) => r.keyword)).toContain("dog cooling mat");
    const overview = await t.query(api.dashboard.overview, {});
    expect(overview?.topNiches[0]).toMatchObject({ niche: "Pet Supplies", thisWeek: 4 });
  });

  it("removes demo supplier listings that only link to a homepage", async () => {
    const t = convexTest(schema, modules);
    const listing = { imageUrl: "", price: 5, orders: 1, rating: 4, reviewCount: 1, shippingDays: 9, storeName: "S", storeRating: 4, sellerCount: 1, niche: "Beauty" };
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierListings", { ...listing, title: "Demo", supplierUrl: "https://www.aliexpress.com" });
      await ctx.db.insert("supplierListings", { ...listing, title: "Real", supplierUrl: "https://www.aliexpress.com/item/100500.html" });
    });
    await runPipeline(t);
    const left = await t.run((ctx) => ctx.db.query("supplierListings").collect());
    expect(left.map((s) => s.title)).toEqual(["Real"]);
  });
});

describe("Ad Spy sort", () => {
  it("'Recently added' lists the newest imports first, whatever their first-seen date", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({ headline: "older import", firstSeenAt: "2026-09-29T00:00:00.000Z" }));
      await ctx.db.insert("ads", ad({ headline: "just imported, ran since June", firstSeenAt: "2026-06-01T00:00:00.000Z", source: "nexscope" }));
    });
    const added = await t.query(api.ads.list, { paginationOpts: { numItems: 5, cursor: null }, sort: "added" });
    expect(added.page[0].headline).toBe("just imported, ran since June");
    const newest = await t.query(api.ads.list, { paginationOpts: { numItems: 5, cursor: null }, sort: "newest" });
    expect(newest.page[0].headline).toBe("older import");
  });
});
