/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const adBase = {
  platform: "Facebook", country: "DK", niche: "Pet Supplies", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

describe("Ad Spy offer filter", () => {
  it("keeps the ads whose text makes the offer, in any of the languages", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
      await ctx.db.insert("ads", { ...adBase, advertiserName: "PawTech", headline: "Køb 2 få 1 gratis i dag" });
      await ctx.db.insert("ads", { ...adBase, advertiserName: "Helysta", headline: "Pude til kontorstolen", bodyText: "50% rabat – kun i dag" });
      await ctx.db.insert("ads", { ...adBase, advertiserName: "Plain", headline: "Our new collection" });
    });
    const user = t.withIdentity({ subject: "u1|s" });
    const list = async (offer?: string) =>
      (await user.query(api.ads.list, { paginationOpts: { numItems: 20, cursor: null }, ...(offer ? { offer } : {}) })).page.map((a) => a.advertiserName).sort();
    expect(await list()).toEqual(["Helysta", "PawTech", "Plain"]);
    expect(await list("bxgy")).toEqual(["PawTech"]);
    expect(await list("percent")).toEqual(["Helysta"]);
    expect(await list("free_shipping")).toEqual([]);
  });
});
