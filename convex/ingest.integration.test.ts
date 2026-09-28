/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal, api } from "./_generated/api";

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
