/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (headline: string, over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "US",
  niche: "Pet Supplies",
  headline,
  bodyText: "No water, no power.",
  creativeUrl: "https://cdn.example.com/a.jpg",
  landingPageUrl: "https://paws.example.com/",
  spendEstimate: "Unknown",
  likes: 0,
  views: "50K",
  daysRunning: 20,
  aiScore: 50,
  targeting: { ageRange: "Unknown", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  source: "apify",
  ...over,
});

describe("ads.list page rank filters", () => {
  it("filters and sorts by rank on the advertiser's page and its live ads", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      await ctx.db.insert("ads", ad("big #2", { pageRank: 2, pageActiveAds: 40 }));
      await ctx.db.insert("ads", ad("big #1", { pageRank: 1, pageActiveAds: 40 }));
      await ctx.db.insert("ads", ad("small #1", { pageRank: 1, pageActiveAds: 3 }));
      await ctx.db.insert("ads", ad("big #12", { pageRank: 12, pageActiveAds: 40 }));
      await ctx.db.insert("ads", ad("unranked", {}));
    });
    const as = t.withIdentity({ subject: "u1|s" });
    const list = async (args: { maxPageRank?: number; minPageAds?: number; sort?: string }) =>
      (await as.query(api.ads.list, { ...args, paginationOpts: { numItems: 20, cursor: null } })).page.map((a) => a.headline);
    expect((await list({ maxPageRank: 10, minPageAds: 10 })).sort()).toEqual(["big #1", "big #2"]);
    expect((await list({ maxPageRank: 1 })).sort()).toEqual(["big #1", "small #1"]);
    expect(await list({ sort: "topRank" })).toEqual(["big #1", "small #1", "big #2", "big #12"]);
    expect((await list({ sort: "pageAds" })).slice(0, 3).every((h) => h.startsWith("big"))).toBe(true);
  });
});
