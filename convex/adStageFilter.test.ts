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
  country: "DK",
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

describe("ads.list stage filter", () => {
  it("returns only ads with the picked stage label", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      await ctx.db.insert("ads", ad("scaling", { isScaling: true, spendEstimate: "$500–$900" }));
      await ctx.db.insert("ads", ad("winning", { spendEstimate: "$150–$400" }));
      await ctx.db.insert("ads", ad("stopped", { spendEstimate: "$150–$400", isActive: false }));
      await ctx.db.insert("ads", ad("new", { daysRunning: 3 }));
      await ctx.db.insert("ads", ad("plain", { spendEstimate: "$20–$60" }));
    });
    const as = t.withIdentity({ subject: "u1|s" });
    const headlines = async (stage: string) =>
      (await as.query(api.ads.list, { stage, paginationOpts: { numItems: 20, cursor: null } })).page.map((a) => a.headline).sort();
    expect(await headlines("scaling")).toEqual(["scaling"]);
    expect(await headlines("winning")).toEqual(["winning"]);
    expect(await headlines("testing")).toEqual(["new"]);
  });
});
