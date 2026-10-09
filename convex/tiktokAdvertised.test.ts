/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("TikTok Shop: products from TikTok ads", () => {
  it("lists the products behind TikTok ads once each, not Facebook ones or services", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      const product = (title: string, category: string, extra = {}) => ctx.db.insert("products", {
        title, description: "", imageUrl: "", category, tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z", ...extra,
      });
      const brush = await product("Pet brush", "Pet Supplies");
      const lamp = await product("Tree lamp", "Home & Living");
      const fbOnly = await product("Facebook-only product", "Home & Living");
      const spa = await product("Mobile spa", "Beauty", { isService: true });
      const ad = (platform: string, productId?: typeof brush) => ctx.db.insert("ads", {
        advertiserName: "Shop", platform, country: "DK", niche: "Pet Supplies", headline: "Hook", bodyText: "Body",
        creativeUrl: "", landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 3, aiScore: 50,
        firstSeenAt: "2026-10-01T00:00:00Z", targeting: { ageRange: "18-65", gender: "All", interests: [] }, source: "apify",
        ...(productId ? { productId } : {}),
      });
      await ad("TikTok", brush);
      await ad("TikTok", brush);
      await ad("TikTok", lamp);
      await ad("TikTok");
      await ad("TikTok", spa);
      await ad("Facebook", fbOnly);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const all = await me.query(api.products.tiktokAdvertised, { paginationOpts: { numItems: 20, cursor: null } });
    expect(all.page.map((p) => p.title).sort()).toEqual(["Pet brush", "Tree lamp"]);
    const mine = await me.query(api.products.tiktokAdvertised, { paginationOpts: { numItems: 20, cursor: null }, niches: ["Pet Supplies"] });
    expect(mine.page.map((p) => p.title)).toEqual(["Pet brush"]);
    await expect(t.query(api.products.tiktokAdvertised, { paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow();
  });
});
