/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const product = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: "",
  imageUrl: `https://img.example/${title}.jpg`,
  category: "Home",
  tags: [],
  aiScore: 80,
  saturation: "Low",
  trend: "Rising",
  supplierUrl: "",
  adExamples: [],
  isWinnerOfDay: false,
  publishedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

describe("homepage winners preview", () => {
  it("puts products from running ads before Amazon best-sellers, and ad headlines last", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const rows = [
        { niche: "Health", p: product("Laxative", { source: "nexscope_api" }) },
        { niche: "Tech", p: product("Earbuds", { source: "nexscope_api", linkedAds: 2 }) },
        { niche: "Home", p: product("Lamp", { source: "adlibrary_api", linkedAds: 4 }) },
        { niche: "Pets", p: product("Pet brush", { linkedAds: 1 }) },
        { niche: "Food", p: product("Get 50% off your first box", { linkedAds: 9 }) },
      ];
      for (const [i, r] of rows.entries()) {
        const productId = await ctx.db.insert("products", r.p);
        await ctx.db.insert("winningProducts", { productId, niche: r.niche, nicheRank: 1, position: i, score: 80, enteredDay: "2026-10-01" });
      }
    });

    const titles = (await t.query(api.winners.homepagePreview, {})).map((r) => r.title);
    // Ad headlines go last, even when they come from ads.
    expect(titles).toEqual(["Lamp", "Pet brush", "Laxative", "Earbuds", "Get 50% off your first box"]);
  });
});
