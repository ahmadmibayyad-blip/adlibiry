/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const page = { paginationOpts: { numItems: 10, cursor: null } };
const adBase = {
  platform: "Facebook", country: "US", bodyText: "", creativeUrl: "", landingPageUrl: "", spendEstimate: "", likes: 0,
  views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated", advertiserName: "Shop",
};

// Ad and product search use a niche/category index for their most common views;
// the results must be exactly what the full-table version returned.
describe("indexed search routes", () => {
  it("Ad Spy: one niche, newest added first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [niche, headline] of [["Pets", "p1"], ["Home", "h1"], ["Pets", "p2"], ["Home", "h2"], ["Pets", "p3"]]) {
        await ctx.db.insert("ads", { ...adBase, niche, headline });
      }
    });
    for (const sort of [undefined, "added"]) {
      const r = await t.query(internal.ads.listInternal, { ...page, niche: "Pets", sort });
      expect(r.page.map((a) => a.headline)).toEqual(["p3", "p2", "p1"]);
    }
  });

  it("Products: one category, highest score first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const base = {
        description: "", imageUrl: "", tags: [], supplierUrl: "", isWinnerOfDay: false, adExamples: [], trend: "Unknown",
        saturation: "Unknown", publishedAt: "2026-09-01T00:00:00.000Z",
      };
      for (const [category, title, aiScore] of [["Pets", "a", 40], ["Home", "b", 99], ["Pets", "c", 90], ["Pets", "d", 70]] as const) {
        await ctx.db.insert("products", { ...base, category, title, aiScore });
      }
    });
    const r = await t.query(internal.products.listInternal, { ...page, category: "Pets", sort: "score" });
    expect(r.page.map((p) => p.title)).toEqual(["c", "d", "a"]);
  });
});
