/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { productHashFields } from "./lib/imageHash";

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

// Passes the Winning Products gates: ~$10K+/month in sales and 5 live ads.
const winner = (over: Partial<NewProduct>): NewProduct => product({ price: 50, unitsPerMonth: 1000, adsCount: 5, ...over });

async function runPipeline(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.productPipeline.start, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return await t.withIdentity({ subject: "test|s" }).query(api.productPipeline.status, {});
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

describe("saturation and duplicates", () => {
  const H = "a5f0c3e1b2d49687"; // a usable image hash
  const NEAR_H = "a5f0c3e1b2d49680"; // the same photo re-compressed: 3 bits differ
  const hashed = (hash: string) => productHashFields(hash, "https://cdn.example.com/p.jpg");

  it("sets saturation from how many advertisers run the product", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const name of ["Paws & Co", "paws & co", "Doggo", "Petsy"]) await ctx.db.insert("ads", ad({ advertiserName: name }));
    });
    await runPipeline(t);
    const [p] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(p.saturation).toBe("Medium"); // 3 different advertisers
  });

  it("attaches an ad to a product from another source with the same image", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", product({ title: "Donut Frost Automatic Pet Feeder WiFi", source: "nexscope_api", ...hashed(H) }));
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://other.example.com/products/pet-feeder-auto", imageHash: NEAR_H }));
      // A blank-image hash is never used to match.
      await ctx.db.insert("products", product({ title: "Blank One Placeholder Item", ...hashed("0000000000000000") }));
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://shop.example.com/products/garden-hose-reel", imageHash: "0000000000000000" }));
    });
    await runPipeline(t);
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products.find((p) => p.source === "nexscope_api")?.linkedAds).toBe(1);
    expect(products.filter((p) => p.source === "ads")).toHaveLength(1); // only the hose reel
    expect(products.find((p) => p.title === "Blank One Placeholder Item")?.linkedAds).toBeUndefined();
  });

  it("merges same-image duplicates into the imported product, keeping ads and saves", async () => {
    const t = convexTest(schema, modules);
    const { userId, keepId, dupId, adId } = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin", role: "admin" });
      const userId = await ctx.db.insert("users", { tokenIdentifier: "user" });
      const keepId = await ctx.db.insert("products", product({ title: "Donut Frost Pet Feeder", source: "nexscope_api", ...hashed(H) }));
      const adId = await ctx.db.insert("ads", ad({}));
      const dupId = await ctx.db.insert("products", product({ title: "Automatic Pet Feeder", source: "ads", ...hashed(NEAR_H), price: 39, adIds: [adId], linkedAds: 1 }));
      await ctx.db.patch("ads", adId, { productId: dupId });
      await ctx.db.insert("savedProducts", { userId, productId: dupId, savedAt: "2026-09-29T00:00:00.000Z" });
      // A different image is left alone.
      await ctx.db.insert("products", product({ title: "Cat Tree Tower", ...hashed("5a0f3c1e2b4d6978") }));
      return { userId, keepId, dupId, adId };
    });
    await t.withIdentity({ subject: "admin|s" }).mutation(api.productPipeline.mergeDuplicatesNow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const status = await t.withIdentity({ subject: "admin|s" }).query(api.productPipeline.dedupStatus, {});
    expect(status).toMatchObject({ state: "done", merged: 1 });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("products", dupId)).toBeNull();
      const keep = (await ctx.db.get("products", keepId))!;
      expect(keep).toMatchObject({ adIds: [adId], linkedAds: 1, price: 39 });
      expect((await ctx.db.get("ads", adId))?.productId).toBe(keepId);
      const saves = await ctx.db.query("savedProducts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
      expect(saves.map((s) => s.productId)).toEqual([keepId]);
    });
    // The next daily run keeps the ad on the merged product (no duplicate re-created).
    await runPipeline(t);
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products.map((p) => p.title).sort()).toEqual(["Cat Tree Tower", "Donut Frost Pet Feeder"]);
    expect(products.find((p) => p._id === keepId)?.linkedAds).toBe(1);
  });
});

describe("Winning Products", () => {
  it("keeps the top 50 per niche with score 65+, excludes flagged items and mixes niches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) await ctx.db.insert("products", winner({ title: `Home thing ${i}`, category: "Home & Living", aiScore: 99 - (i % 30) }));
      for (let i = 0; i < 3; i++) await ctx.db.insert("products", winner({ title: `Pet thing ${i}`, category: "Pet Supplies", aiScore: 90 - i }));
      await ctx.db.insert("products", winner({ title: "Sporty thing", category: "Sports", aiScore: 80 }));
      await ctx.db.insert("products", winner({ title: "Weak thing", category: "Sports", aiScore: 64 }));
      await ctx.db.insert("products", winner({ title: "Personalized name necklace", category: "Jewelry", aiScore: 95 }));
    });
    await runPipeline(t);

    const summary = await t.query(api.winners.summary, {});
    expect(summary.total).toBe(50 + 3 + 1);
    expect(Object.fromEntries(summary.perNiche.map((n) => [n.niche, n.filled]))).toEqual({ "Home & Living": 50, "Pet Supplies": 3, Sports: 1 });

    const feed = await t.withIdentity({ subject: "test|s" }).query(api.winners.feed, { paginationOpts: { numItems: 10, cursor: null } });
    const niches = feed.page.map((r) => r.niche);
    // Home & Living has the best product, so it leads; then the niches alternate.
    expect(niches.slice(0, 7)).toEqual(["Home & Living", "Pet Supplies", "Sports", "Home & Living", "Pet Supplies", "Home & Living", "Pet Supplies"]);
    expect(feed.page[0]).toMatchObject({ nicheRank: 1, isNewToday: true });
    expect(feed.page[0].product.winnerRank).toBe(1);

    // Next day: same round, still "new". Three days later a new round: the
    // best product stays and is no longer new.
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    const sameRound = await t.withIdentity({ subject: "test|s" }).query(api.winners.feed, { paginationOpts: { numItems: 1, cursor: null } });
    expect(sameRound.page[0].isNewToday).toBe(true);
    vi.setSystemTime(new Date("2026-10-03T08:05:00Z"));
    await runPipeline(t);
    const again = await t.withIdentity({ subject: "test|s" }).query(api.winners.feed, { paginationOpts: { numItems: 1, cursor: null } });
    expect(again.page[0].isNewToday).toBe(false);
  });

  it("clears the rank of products that drop out", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("products", winner({ aiScore: 80 })));
    await runPipeline(t);
    expect((await t.run((ctx) => ctx.db.get("products", id)))?.winnerRank).toBe(1);
    await t.run((ctx) => ctx.db.patch("products", id, { aiScore: 50 }));
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    expect((await t.run((ctx) => ctx.db.get("products", id)))?.winnerRank).toBeUndefined();
    expect((await t.query(api.winners.summary, {})).total).toBe(0);
  });
});

describe("Scaling ads", () => {
  it("marks ads running 14+ days whose views grew 10%+ in a week, and Ad Spy can filter them", async () => {
    const t = convexTest(schema, modules);
    const { scalingId, flatId } = await t.run(async (ctx) => {
      const scalingId = await ctx.db.insert("ads", ad({ daysRunning: 30, views: "12.0K", likes: 0 }));
      const flatId = await ctx.db.insert("ads", ad({ daysRunning: 30, views: "10.0K", likes: 0, advertiserName: "Other" }));
      for (const [id, views] of [[scalingId, 10_000], [flatId, 10_000]] as const) {
        await ctx.db.insert("dailySnapshots", { day: "2026-09-20", kind: "ad", entityId: id, score: 70, adsRunning: 1, views, likes: 0, comments: 0, spend: 0, gmv: 0 });
      }
      await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      return { scalingId, flatId };
    });
    await runPipeline(t);
    const ads = await t.run(async (ctx) => [await ctx.db.get("ads", scalingId), await ctx.db.get("ads", flatId)]);
    expect(ads[0]?.isScaling).toBe(true); // 10K → 12K
    expect(ads[1]?.isScaling).toBeFalsy();
    const page = await t.withIdentity({ subject: "pro|s" }).query(api.ads.list, { paginationOpts: { numItems: 10, cursor: null }, scalingOnly: true });
    expect(page.page.map((a) => a._id)).toEqual([scalingId]);
  });
});

describe("Pro product alerts", () => {
  it("free users can't follow; Pro users get alerts for new ads and a score past their threshold", async () => {
    const t = convexTest(schema, modules);
    const { productId } = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "free", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      return { productId: await ctx.db.insert("products", product({ title: "Dog cooling mat", aiScore: 60, storeUrl: "https://paws.example.com/products/dog-cooling-mat" })) };
    });
    await expect(t.withIdentity({ subject: "free|s" }).mutation(api.follows.followProduct, { productId })).rejects.toThrow(/Pro feature/);
    const pro = t.withIdentity({ subject: "pro|s" });
    await pro.mutation(api.follows.followProduct, { productId, minScore: 75 });
    expect(await pro.query(api.follows.productFollow, { productId })).toEqual({ minScore: 75 });

    // Next day: two ads for it appear and its score passes 75.
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://paws.example.com/products/dog-cooling-mat", aiScore: 90 }));
      await ctx.db.insert("ads", ad({ landingPageUrl: "https://paws.example.com/products/dog-cooling-mat?v=2", aiScore: 85, advertiserName: "Doggo" }));
    });
    await runPipeline(t);
    await t.run((ctx) => ctx.db.patch("products", productId, { aiScore: 80 })); // e.g. after the switch to v2
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    const titles = notes.map((n) => n.title);
    expect(titles).toContain("2 new ads for Dog cooling mat");
    expect(titles).toContain("Dog cooling mat reached a score of 80");
  });
});

describe("same-store duplicates", () => {
  it("merges one shop's listing imported under two names and keeps the other name as an alias", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
      await ctx.db.insert("products", product({ title: "Dog Cooling Mat for Large Dogs", source: "shopify", storeUrl: "https://paws.example.com/products/cool-mat" }));
      await ctx.db.insert("products", product({ title: "Large dog cooling mat", source: "ads", storeUrl: "https://www.paws.example.com/products/cooling-mat-xl" }));
      await ctx.db.insert("products", product({ title: "Cat water fountain", source: "ads", storeUrl: "https://paws.example.com/products/fountain" }));
    });
    await runPipeline(t); // fills storeHost
    await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.mergeDuplicatesNow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products.map((p) => p.title).sort()).toEqual(["Cat water fountain", "Dog Cooling Mat for Large Dogs"]);
    expect(products.find((p) => p.title.startsWith("Dog"))?.aliases).toEqual(["Large dog cooling mat"]);
  });
});

describe("winner gates and score v2", () => {
  it("keeps products without real sales, live ads or room in the market out of Winning Products", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", winner({ title: "Real winner", category: "Pet Supplies", aiScore: 90 }));
      await ctx.db.insert("products", winner({ title: "Tiny sales", category: "Pet Supplies", aiScore: 99, unitsPerMonth: 10 }));
      await ctx.db.insert("products", winner({ title: "One ad", category: "Pet Supplies", aiScore: 98, adsCount: 1 }));
      await ctx.db.insert("products", winner({ title: "Crowded", category: "Pet Supplies", aiScore: 97, saturation: "High" }));
      await ctx.db.insert("products", winner({ title: "Falling", category: "Pet Supplies", aiScore: 96, momentum14: -12 }));
    });
    const status = await runPipeline(t);
    const feed = await t.withIdentity({ subject: "test|s" }).query(api.winners.feed, { paginationOpts: { numItems: 10, cursor: null } });
    expect(feed.page.map((r) => r.product.title)).toEqual(["Real winner"]);
    expect(status?.counts.winnersGated).toBe(4);
  });

  it("scores every product in five parts and reports the v2 distribution without changing live scores", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
      for (let i = 0; i < 40; i++) {
        await ctx.db.insert("products", product({ title: `Thing ${i}`, aiScore: 99, price: 20 + i, unitsPerMonth: 10 * (i + 1), adsCount: i % 7 }));
      }
    });
    await runPipeline(t);
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    expect(products.every((p) => p.aiScore === 99)).toBe(true); // v1 still live
    expect(products.every((p) => p.scoreParts && p.scoreParts.v2 !== undefined)).toBe(true);
    const v2 = products.map((p) => p.scoreParts!.v2!).sort((a, b) => a - b);
    expect(new Set(v2).size).toBeGreaterThan(10); // spread out, not clustered at 99
    const admin = t.withIdentity({ subject: "a1|s" });
    const { model, report } = await admin.query(api.productPipeline.scoreCalibration, {});
    expect(model).toBe("v1");
    expect(report?.before.share85).toBe(1);
    expect(report?.after.share85).toBeLessThan(0.15);
    expect(report?.after.median).toBeGreaterThanOrEqual(35);
    expect(report?.after.median).toBeLessThanOrEqual(55);

    // Switching to v2 makes the calibrated scores live; back to v1 restores the importers' scores.
    await admin.mutation(api.productPipeline.setScoreModel, { model: "v2" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const live = await t.run((ctx) => ctx.db.query("products").collect());
    expect(live.every((p) => p.aiScore === p.scoreParts!.v2)).toBe(true);
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await admin.mutation(api.productPipeline.setScoreModel, { model: "v1" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const restored = await t.run((ctx) => ctx.db.query("products").collect());
    expect(restored.every((p) => p.aiScore === 99)).toBe(true);
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

    const history = await t.withIdentity({ subject: "test|s" }).query(api.history.adHistory, { adId: adId as Id<"ads">, days: 7 });
    expect(history).toHaveLength(1);
  });

  it("skips unchanged days but still charts every day, and trends from the last change", async () => {
    const t = convexTest(schema, modules);
    const adId = await t.run((ctx) => ctx.db.insert("ads", ad({ views: "10.0K", likes: 50 })));
    await runPipeline(t); // 2026-09-30
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t); // nothing changed
    vi.setSystemTime(new Date("2026-10-02T08:05:00Z"));
    await runPipeline(t); // nothing changed

    const adRows = (await t.run((ctx) => ctx.db.query("dailySnapshots").collect())).filter((r) => r.kind === "ad");
    expect(adRows.map((r) => r.day)).toEqual(["2026-09-30"]);
    const history = await t.withIdentity({ subject: "test|s" }).query(api.history.adHistory, { adId: adId as Id<"ads">, days: 7 });
    expect(history.map((r) => [r.day, r.views])).toEqual([
      ["2026-09-30", 10_000], ["2026-10-01", 10_000], ["2026-10-02", 10_000],
    ]);

    // A week after the only stored product row, views grew 50%: still "Rising".
    vi.setSystemTime(new Date("2026-10-07T08:05:00Z"));
    await t.run((ctx) => ctx.db.patch("ads", adId, { views: "15.0K" }));
    await runPipeline(t);
    const [p] = await t.run((ctx) => ctx.db.query("products").collect());
    expect(p.trend).toBe("Rising");
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
  it("runs every step in order, logs each one, and can re-run from a step", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }));
    const status = await runPipeline(t);
    expect(status?.log?.map((l) => l.stage)).toEqual([
      "hashImages", "keys", "link", "landingPages", "dedupe", "stores", "aggregate", "calibrateScan", "calibrateApply",
      "winners", "fusion", "snapshotProducts", "snapshotAds", "prune", "alerts", "storeAds", "lists", "emails", "done",
    ]);
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    expect(await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.runFrom, { stage: "winners" })).toEqual({ started: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const again = await t.withIdentity({ subject: "a1|s" }).query(api.productPipeline.status, {});
    expect(again?.log?.[0].stage).toBe("winners");
    expect(again?.state).toBe("done");
  });

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
      (await t.query(internal.products.listInternal, { paginationOpts: { numItems: 50, cursor: null }, ...args })).page.map((p) => p.title).sort();

    expect(await list({ categories: ["Pet Supplies", "Sports"] })).toEqual(["Ball", "Dog Cooling Mat"]);
    expect(await list({ origin: "ads" })).toEqual(["Dog Cooling Mat"]);
    expect(await list({ origin: "db", hidePersonalised: true })).toEqual(["Ball", "Cheap lamp", "Fancy lamp"]);
    const byMargin = (await t.query(internal.products.listInternal, { paginationOpts: { numItems: 2, cursor: null }, sort: "margin" })).page.map((p) => p.title);
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
    const trends = await t.query(internal.trends.listInternal, {});
    expect(trends.map((r) => r.keyword)).toContain("dog cooling mat");
    const overview = await t.withIdentity({ subject: "test|s" }).query(api.dashboard.overview, {});
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
    const added = await t.query(internal.ads.listInternal, { paginationOpts: { numItems: 5, cursor: null }, sort: "added" });
    expect(added.page[0].headline).toBe("just imported, ran since June");
    const newest = await t.query(internal.ads.listInternal, { paginationOpts: { numItems: 5, cursor: null }, sort: "newest" });
    expect(newest.page[0].headline).toBe("older import");
  });

  it("the home page's Just added shows the newest ads and products first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({ headline: "first" }));
      await ctx.db.insert("ads", ad({ headline: "latest import", firstSeenAt: "2026-01-01T00:00:00.000Z" }));
      await ctx.db.insert("products", product({ title: "old product" }));
      await ctx.db.insert("products", product({ title: "new product" }));
    });
    const j = await t.withIdentity({ subject: "test|s" }).query(api.dashboard.justAdded, {});
    expect(j.ads[0].headline).toBe("latest import");
    expect(j.products[0].title).toBe("new product");
  });
});

describe("Estimates", () => {
  it("the daily run fills in modelled impressions, spend and revenue", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", ad({ likes: 3000, views: "", spendEstimate: "Unknown", landingPageUrl: "https://paws.example.com/products/dog-cooling-mat" }));
      await ctx.db.insert("products", product({ title: "Shopify mat", price: 40, description: "Shopify store product running Facebook ads · 100 orders last week (est.)" }));
    });
    await runPipeline(t);
    const ps = await t.run((ctx) => ctx.db.query("products").collect());
    const fromAd = ps.find((p) => (p.linkedAds ?? 0) > 0)!;
    expect(fromAd.estBasis?.impressions).toBe("engagement");
    expect(fromAd.estImpressions?.high).toBeGreaterThan(0);
    const shop = ps.find((p) => p.title === "Shopify mat")!;
    expect(shop.unitsPerMonth).toBe(430);
    expect(shop.estRevenue).toEqual({ low: 12040, high: 22360 });
    expect(shop.estBasis?.revenue).toBe("marketplace_sales");
  });
});

describe("Winning Products filters", () => {
  it("filters, sorts and pages the list", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", winner({ title: "Dog cooling mat", category: "Pet Supplies", aiScore: 90, price: 40, cost: 10 }));
      await ctx.db.insert("products", winner({ title: "Cat water fountain", category: "Pet Supplies", aiScore: 80, price: 25, cost: 20 }));
      await ctx.db.insert("products", winner({ title: "Yoga mat", category: "Sports", aiScore: 70, price: 60, cost: 15 }));
    });
    await runPipeline(t);
    // A paying account, so paging isn't capped at the free 10.
    await t.run((ctx) => ctx.db.insert("users", { email: "pro@x.com", tokenIdentifier: "pro", plan: "pro", subscriptionStatus: "active" }));
    const user = t.withIdentity({ subject: "pro|s" });
    const page = { paginationOpts: { numItems: 10, cursor: null } };
    const titles = async (args: Record<string, unknown>) =>
      (await user.query(api.winners.feed, { ...page, ...args })).page.map((r) => r.product.title);

    expect(await titles({ search: "mat" })).toEqual(["Dog cooling mat", "Yoga mat"]);
    expect(await titles({ minMargin: 70 })).toEqual(["Dog cooling mat", "Yoga mat"]);
    expect(await titles({ maxPrice: 30 })).toEqual(["Cat water fountain"]);
    expect(await titles({ niche: "Pet Supplies", sort: "priceLow" })).toEqual(["Cat water fountain", "Dog cooling mat"]);
    expect(await titles({ sort: "priceHigh" })).toEqual(["Yoga mat", "Dog cooling mat", "Cat water fountain"]);

    const first = await user.query(api.winners.feed, { paginationOpts: { numItems: 2, cursor: null }, sort: "score" });
    expect(first.isDone).toBe(false);
    const rest = await user.query(api.winners.feed, { paginationOpts: { numItems: 2, cursor: first.continueCursor }, sort: "score" });
    expect([...first.page, ...rest.page].map((r) => r.product.title)).toEqual(["Dog cooling mat", "Cat water fountain", "Yoga mat"]);
    expect(rest.isDone).toBe(true);
  });
});

describe("Winning Products every 3 days", () => {
  const ids = async (t: ReturnType<typeof convexTest>) =>
    new Set(await t.run(async (ctx) => (await ctx.db.query("winningProducts").collect()).map((r) => r.productId as string)));

  it("keeps the mix between rounds and draws a new one every 3 days", async () => {
    const t = convexTest(schema, modules);
    const best = await t.run(async (ctx) => {
      const out: Id<"products">[] = [];
      for (let i = 0; i < 120; i++) out.push(await ctx.db.insert("products", product({ title: `Pet ${i}`, category: "Pet Supplies", aiScore: 99 - Math.floor(i / 4) })));
      return out.slice(0, 25);
    });
    await runPipeline(t);
    const round1 = await ids(t);
    expect(round1.size).toBe(50);
    const summary = await t.query(api.winners.summary, {});
    expect(summary).toMatchObject({ roundDay: "2026-09-30", nextRoundDay: "2026-10-03", roundDays: 3 });

    // A new product scoring 100 the next day doesn't jump in mid-round.
    await t.run((ctx) => ctx.db.insert("products", product({ title: "New star", category: "Pet Supplies", aiScore: 100 })));
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await runPipeline(t);
    expect(await ids(t)).toEqual(round1);

    // Round 2: the best 25 (now incl. the new one) stay, the rotating half is
    // drawn from products that weren't shown last time.
    vi.setSystemTime(new Date("2026-10-03T08:05:00Z"));
    await runPipeline(t);
    const round2 = await ids(t);
    expect(round2.size).toBe(50);
    for (const id of best.slice(0, 24)) expect(round2.has(id)).toBe(true);
    const rotated = [...round2].filter((id) => !round1.has(id));
    expect(rotated.length).toBeGreaterThanOrEqual(25);
  });

  it("lets the admin's Run now draw a new mix the same day", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "a@x.com", tokenIdentifier: "a1", role: "admin" });
      for (let i = 0; i < 120; i++) await ctx.db.insert("products", product({ title: `Pet ${i}`, category: "Pet Supplies", aiScore: 70 + (i % 20) }));
    });
    await runPipeline(t);
    const before = await ids(t);
    vi.setSystemTime(new Date("2026-10-01T08:05:00Z"));
    await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.runNow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await ids(t);
    expect([...after].filter((id) => !before.has(id)).length).toBeGreaterThan(0);
    expect((await t.query(api.winners.summary, {})).roundDay).toBe("2026-10-01");
  });
});

describe("pipeline never gets stuck", () => {
  it("fills Winning Products with products that only lack data, never with ones that fail on real numbers", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", winner({ title: "Proven", category: "Pet Supplies", aiScore: 80 }));
      // No price/sales and no ad count yet: unknown, not failed.
      await ctx.db.insert("products", product({ title: "No data yet", category: "Pet Supplies", aiScore: 95 }));
      await ctx.db.insert("products", winner({ title: "Tiny sales", category: "Pet Supplies", aiScore: 99, unitsPerMonth: 10 }));
      await ctx.db.insert("products", product({ title: "Crowded, no data", category: "Pet Supplies", aiScore: 97, saturation: "High" }));
    });
    const status = await runPipeline(t);
    const feed = await t.withIdentity({ subject: "test|s" }).query(api.winners.feed, { paginationOpts: { numItems: 10, cursor: null } });
    // Proven winners first, then the best of the ones we lack data for.
    expect(feed.page.map((r) => r.product.title)).toEqual(["Proven", "No data yet"]);
    expect(status?.counts.winnersGated).toBe(2);
  });

  it("the watchdog skips a step that stopped reporting and the run goes on to the end", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("products", winner({ title: "Proven", category: "Pet Supplies", aiScore: 80 })));
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await t.run((ctx) =>
      ctx.db.insert("siteStats", {
        key: "productPipeline",
        updatedAt: old,
        data: { state: "running", stage: "dedupe", day: "2026-09-30", startedAt: old, updatedAt: old, runId: "r1", counts: { productsCreated: 0, adsLinked: 0, winners: 0, snapshots: 0, pruned: 0 } },
      }),
    );
    await t.mutation(internal.productPipeline.watchdog, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const status = await t.withIdentity({ subject: "test|s" }).query(api.productPipeline.status, {});
    expect(status?.state).toBe("done");
    expect(status?.warnings?.[0]).toMatch(/Merging duplicates: no progress for 30 min/);
    expect(status?.counts.winners).toBe(1);
  });

  it("an admin can restart a stalled run, and the old run's steps quit", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }));
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await t.run((ctx) =>
      ctx.db.insert("siteStats", {
        key: "productPipeline",
        updatedAt: old,
        data: { state: "running", stage: "link", day: "2026-09-30", startedAt: old, updatedAt: old, runId: "old", counts: { productsCreated: 0, adsLinked: 0, winners: 0, snapshots: 0, pruned: 0 } },
      }),
    );
    expect(await t.withIdentity({ subject: "a1|s" }).mutation(api.productPipeline.runNow, {})).toEqual({ started: true });
    // A leftover step of the old run does nothing.
    await t.mutation(internal.productPipeline.step, { stage: "prune", cursor: null, day: "2026-09-30", runId: "old" });
    const status = await t.withIdentity({ subject: "test|s" }).query(api.productPipeline.status, {});
    expect(status?.stage).toBe("hashImages");
  });

  it("marks a duplicate merge that stopped reporting as stalled so it can be started again", async () => {
    const t = convexTest(schema, modules);
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    await t.run((ctx) => ctx.db.insert("siteStats", { key: "productDedup", updatedAt: old, data: { state: "running", merged: 0, startedAt: old } }));
    await t.mutation(internal.productPipeline.watchdog, {});
    const d = await t.run(async (ctx) => (await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productDedup")).unique())?.data);
    expect(d).toMatchObject({ state: "stalled" });
  });
});
