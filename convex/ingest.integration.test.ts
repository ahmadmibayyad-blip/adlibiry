/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal, api } from "./_generated/api";
import { initNewUser } from "./lib/userRole";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");

const adArgs = {
  advertiserName: "Glow Co",
  platform: "Facebook",
  country: "DK",
  niche: "Home & Living",
  headline: "Glow lamp",
  bodyText: "Best lamp ever",
  creativeUrl: "https://cdn.example.com/a.jpg",
  landingPageUrl: "https://glow.example.com",
  spendEstimate: "Unknown",
  likes: 10,
  views: "1.0K",
  daysRunning: 20,
  aiScore: 50,
  firstSeenAt: "2026-08-01T00:00:00.000Z",
};

describe("AdLibrary re-sync", () => {
  it("never makes a known ad look newer or smaller", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.adlibrary.sync.upsertAd, { ...adArgs, externalId: "k1", impressions: 50_000, views: "50.0K", firstSeenKnown: true });
    await t.run(async (ctx) => {
      const [ad] = await ctx.db.query("ads").collect();
      await ctx.db.patch("ads", ad._id, { videoUrl: "https://v.example.com/a.mp4", mediaType: "video" }); // from enrichment
    });
    // Next day: search result lacks first_seen, reports less reach and no video.
    await t.mutation(internal.adlibrary.sync.upsertAd, {
      ...adArgs,
      externalId: "k1",
      firstSeenAt: "2026-09-28T00:00:00.000Z",
      firstSeenKnown: false,
      daysRunning: 3,
      impressions: 1_000,
      views: "1.0K",
      mediaType: "image",
      likes: 25,
    });
    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      daysRunning: 20,
      impressions: 50_000,
      views: "50.0K",
      mediaType: "video",
      likes: 25, // fresh metrics still update
    });
  });
});

describe("winner of the day", () => {
  it("keeps one AdLibrary winner per niche", async () => {
    const t = convexTest(schema, modules);
    const pick = (adKey: string, niche: string) =>
      t.mutation(internal.adlibrary.productSync.upsertProductFromTopAd, {
        niche, adKey, advertiserName: "A", platform: "facebook", headline: `Top ${adKey}`, bodyText: "",
        imageUrl: "https://cdn.example.com/p.jpg", landingPageUrl: "", heat: 800, daysCount: 5, impression: 100,
      });
    await pick("day1", "Beauty");
    await pick("other", "Fashion");
    await pick("day2", "Beauty");
    const winners = await t.run((ctx) =>
      ctx.db.query("products").withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true)).collect(),
    );
    expect(winners.map((w) => w.title).sort()).toEqual(["Top day2", "Top other"]);
  });
});

describe("extension submissions", () => {
  const submission = {
    submitterVisitorId: "v1",
    advertiserName: "Glow Co",
    platform: "Facebook",
    headline: "Glow lamp",
    bodyText: "Best lamp ever",
    creativeUrl: "https://cdn.example.com/a.jpg",
    landingPageUrl: "https://glow.example.com",
    sourceUrl: "https://www.facebook.com/ads/library/",
    adKey: "meta_123",
    likes: 10,
  };

  it("dedupes repeat submissions and carries scraped data into Ad Spy", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.submittedAds.submitFromExtension, submission);
    await t.mutation(internal.submittedAds.submitFromExtension, {
      ...submission,
      submitterVisitorId: "v2",
      likes: 99,
      videoUrl: "https://v.example.com/a.mp4",
      mediaType: "video",
      countries: ["DK", "SE"],
      startedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    });
    const subs = await t.run((ctx) => ctx.db.query("submittedAds").collect());
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ likes: 99, submitterVisitorId: "v1", videoUrl: "https://v.example.com/a.mp4" });

    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" }));
    const admin = t.withIdentity({ subject: "admin1|session" });
    await expect(
      admin.mutation(api.submittedAds.approveSubmission, { id: subs[0]._id, niche: "Home & Living", country: "Denmark", spendEstimate: "Unknown", views: "0", aiScore: 40 }),
    ).rejects.toThrow(/2-letter/);
    await admin.mutation(api.submittedAds.approveSubmission, { id: subs[0]._id, niche: "Home & Living", country: "dk", spendEstimate: "Unknown", views: "0", aiScore: 40 });

    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({
      source: "extension",
      country: "DK",
      likes: 99,
      videoUrl: "https://v.example.com/a.mp4",
      mediaType: "video",
      countries: ["DK", "SE"],
      daysRunning: 12,
      externalKey: "meta_123",
    });
  });

  it("does not let regular users seed demo data", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const user = t.withIdentity({ subject: "u1|s" });
    await expect(user.mutation(api.products.seedProducts, {})).rejects.toThrow(/Admin/);
    await expect(user.mutation(api.ads.seedAds, {})).rejects.toThrow(/Admin/);
  });
});

describe("niches and winners", () => {
  it("files the daily pick by what it sells, and still retires yesterday's pick for that search", async () => {
    const t = convexTest(schema, modules);
    const pick = (adKey: string, headline: string) =>
      t.mutation(internal.adlibrary.productSync.upsertProductFromTopAd, {
        niche: "Beauty", adKey, advertiserName: "A", platform: "facebook", headline, bodyText: "",
        imageUrl: "https://cdn.example.com/p.jpg", landingPageUrl: "", heat: 800, daysCount: 5, impression: 100,
      });
    await pick("d1", "No-pull dog harness"); // found by the Beauty search, but it's a pet product
    await pick("d2", "Vitamin C face serum");
    const products = await t.run((ctx) => ctx.db.query("products").collect());
    const byTitle = Object.fromEntries(products.map((p) => [p.title, p]));
    expect(byTitle["No-pull dog harness"]).toMatchObject({ category: "Pet Supplies", isWinnerOfDay: false });
    expect(byTitle["Vitamin C face serum"]).toMatchObject({ category: "Beauty", isWinnerOfDay: true });
  });

  it("re-checks niches of auto-imported ads only", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" });
      const base = { ...adArgs, targeting: { ageRange: "Unknown", gender: "All", interests: [] as string[] } };
      await ctx.db.insert("ads", { ...base, niche: "Beauty", headline: "No-pull dog harness", source: "apify" });
      await ctx.db.insert("ads", { ...base, niche: "Beauty", headline: "No-pull dog harness", source: "curated" });
    });
    await t.withIdentity({ subject: "admin1|s" }).mutation(api.admin.reclassify.start, {});
    await settle(t);
    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads.find((a) => a.source === "apify")?.niche).toBe("Pet Supplies");
    expect(ads.find((a) => a.source === "curated")?.niche).toBe("Beauty"); // hand-set niches are kept
  });
});

describe("new Ad Spy filters", () => {
  it("filters by last seen, impression range and max spend", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      const base = { ...adArgs, targeting: { ageRange: "Unknown", gender: "All", interests: [] as string[] }, source: "apify" };
      await ctx.db.insert("ads", { ...base, headline: "fresh-small", impressions: 5_000, spendEstimate: "~$500 (AdLibrary est.)", lastSeenAt: new Date(now - 86_400_000).toISOString() });
      await ctx.db.insert("ads", { ...base, headline: "old-big", impressions: 2_000_000, spendEstimate: "~$80K (AdLibrary est.)", lastSeenAt: new Date(now - 20 * 86_400_000).toISOString() });
      await ctx.db.insert("ads", { ...base, headline: "no-spend", impressions: 50_000, spendEstimate: "Unknown", lastSeenAt: new Date(now).toISOString() });
    });
    const list = (extra: Record<string, unknown>) =>
      t.query(internal.ads.listInternal, { paginationOpts: { numItems: 50, cursor: null }, ...extra }).then((r) => r.page.map((a) => a.headline).sort());
    expect(await list({ lastSeenWithinDays: 3 })).toEqual(["fresh-small", "no-spend"]);
    expect(await list({ minImpressions: 10_000, maxImpressions: 100_000 })).toEqual(["no-spend"]);
    expect(await list({ maxSpend: 1_000 })).toEqual(["fresh-small"]);
  });

  it("'under X impressions' skips ads with no impression data", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const base = { ...adArgs, targeting: { ageRange: "Unknown", gender: "All", interests: [] as string[] }, source: "apify" };
      await ctx.db.insert("ads", { ...base, headline: "small", impressions: 5_000 });
      await ctx.db.insert("ads", { ...base, headline: "no-data" });
    });
    const r = await t.query(internal.ads.listInternal, { paginationOpts: { numItems: 50, cursor: null }, maxImpressions: 10_000 });
    expect(r.page.map((a) => a.headline)).toEqual(["small"]);
  });
});

describe("Winning Products filters", () => {
  it("filters by ads, likes, growth, date added, price and store link", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      const base = {
        description: "", imageUrl: "https://cdn.example.com/p.jpg", category: "Pet Supplies", tags: [], aiScore: 50,
        saturation: "Unknown", trend: "Stable", adExamples: [], isWinnerOfDay: false, source: "winninghunter",
      };
      await ctx.db.insert("products", { ...base, title: "hot", supplierUrl: "https://shop.dk/p", price: 29, adsCount: 120, likes: 5_000, growthPercent: 80, publishedAt: new Date(now - 2 * 86_400_000).toISOString() });
      await ctx.db.insert("products", { ...base, title: "cooling", supplierUrl: "", adsCount: 5, likes: 50, growthPercent: -20, publishedAt: new Date(now - 60 * 86_400_000).toISOString() });
      await ctx.db.insert("products", { ...base, title: "no-data", supplierUrl: "", publishedAt: new Date(now - 90 * 86_400_000).toISOString() });
    });
    const list = (extra: Record<string, unknown>) =>
      t.query(internal.products.listInternal, { paginationOpts: { numItems: 50, cursor: null }, ...extra }).then((r) => r.page.map((p) => p.title).sort());
    expect(await list({ minAds: 50, maxAds: 199 })).toEqual(["hot"]);
    expect(await list({ maxAds: 9 })).toEqual(["cooling"]); // no ad count ≠ "1–9 ads"
    expect(await list({ minLikes: 1_000 })).toEqual(["hot"]);
    expect(await list({ maxGrowth: 0 })).toEqual(["cooling"]); // "Declining" skips products without growth data
    expect(await list({ minGrowth: 50 })).toEqual(["hot"]);
    expect(await list({ publishedWithinDays: 7 })).toEqual(["hot"]);
    expect(await list({ hasPrice: true })).toEqual(["hot"]);
    expect(await list({ hasStoreLink: true })).toEqual(["hot"]);
  });
});

describe("admin access", () => {
  it("only the very first account becomes admin — a listed email no longer grants it", async () => {
    const t = convexTest(schema, modules);
    process.env.ADMIN_EMAILS = "owner@example.com";
    const roles = await t.run(async (ctx) => {
      const first = await ctx.db.insert("users", { email: "first@example.com" });
      await initNewUser(ctx, first);
      // A later sign-up using a listed-but-unregistered email stays a normal user.
      const claimed = await ctx.db.insert("users", { email: "owner@example.com" });
      await initNewUser(ctx, claimed);
      return [(await ctx.db.get("users", first))?.role, (await ctx.db.get("users", claimed))?.role];
    });
    expect(roles).toEqual(["admin", "user"]);
    delete process.env.ADMIN_EMAILS;
  });

  it("does not let regular users seed demo stores or research data", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const user = t.withIdentity({ subject: "u1|s" });
    await expect(user.mutation(api.stores.seedStores, {})).rejects.toThrow(/Admin/);
    await expect(user.mutation(api.trends.seedResearchData, {})).rejects.toThrow(/Admin/);
  });
});
