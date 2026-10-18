/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const adBase = {
  platform: "Facebook", country: "DK", niche: "Pet Supplies", bodyText: "", headline: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "meta_ad_library",
};
const eu = (totalReach: number) => ({ audience: { totalReach, ages: [], countries: [] } });

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
    await ctx.db.insert("ads", { ...adBase, advertiserName: "Small", ...eu(1_000), isActive: true }); // $9
    await ctx.db.insert("ads", { ...adBase, advertiserName: "Big", ...eu(100_000), isActive: true }); // $900
    await ctx.db.insert("ads", { ...adBase, advertiserName: "Big", ...eu(20_000), isActive: false }); // $180
    await ctx.db.insert("ads", { ...adBase, advertiserName: "NoEU", spendEstimate: "$500–$1K (AdLibrary est.)" });
  });
  return t.withIdentity({ subject: "u1|s" });
}
const page = { paginationOpts: { numItems: 20, cursor: null } };

describe("Ad Spy EU spend (reach × CPM)", () => {
  it("sorts highest spend by EU reach", async () => {
    const user = await setup();
    const res = await user.query(api.ads.list, { ...page, sort: "highestSpend" });
    expect(res.page.map((a) => a.audience?.totalReach ?? 0)).toEqual([100_000, 20_000, 1_000, 0]);
  });

  it("filters EU-only ads and reach ranges", async () => {
    const user = await setup();
    const names = async (args: object) => (await user.query(api.ads.list, { ...page, ...args })).page.map((a) => a.advertiserName).sort();
    expect(await names({ euOnly: true })).toEqual(["Big", "Big", "Small"]);
    expect(await names({ minReach: 10_000, maxReach: 50_000 })).toEqual(["Big"]);
  });

  it("filters spend with the user's CPM, falling back to the source's figure", async () => {
    const user = await setup();
    const reachOf = async (args: object) =>
      (await user.query(api.ads.list, { ...page, ...args })).page.map((a) => `${a.advertiserName}:${a.audience?.totalReach ?? "-"}`).sort();
    // $9 CPM: 900, 180, 9 from reach; NoEU's own range tops out at $1K.
    expect(await reachOf({ minSpend: 150, maxSpend: 950 })).toEqual(["Big:100000", "Big:20000"]);
    // $18 CPM doubles reach-based spend: 1800, 360, 18.
    expect(await reachOf({ minSpend: 150, maxSpend: 950, cpm: 18 })).toEqual(["Big:20000"]);
    expect(await reachOf({ minSpend: 999 })).toEqual(["NoEU:-"]);
  });

  it("totals an advertiser's EU reach over the ads we have", async () => {
    const user = await setup();
    expect(await user.query(api.ads.advertiserReach, { advertiserName: "Big" })).toEqual({ ads: 2, more: false, euAds: 2, activeAds: 1, reach: 120_000 });
    expect(await user.query(api.ads.advertiserReach, { advertiserName: "NoEU" })).toMatchObject({ ads: 1, euAds: 0, reach: 0 });
    expect(await user.query(api.ads.advertiserReach, { advertiserName: "Unknown advertiser" })).toBeNull();
  });
});
