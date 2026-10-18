/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "DK",
  niche: "Pet Supplies",
  headline: "Keep your dog cool",
  bodyText: "No water, no power.",
  creativeUrl: "https://cdn.example.com/a.jpg",
  landingPageUrl: "https://paws.example.com/products/cool-mat",
  spendEstimate: "Unknown",
  likes: 0,
  views: "0",
  daysRunning: 10,
  aiScore: 50,
  targeting: { ageRange: "Unknown", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  source: "apify",
  ...over,
});

describe("stores.forAd", () => {
  it("joins the ad's shop with our store row and its last inspection", async () => {
    const t = convexTest(schema, modules);
    const { adId, bareId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1" });
      await ctx.db.insert("stores", {
        name: "Paws & Co", url: "https://paws.example.com", logoUrl: "", niche: "Pet Supplies", country: "DK", platform: "Shopify",
        estimatedRevenueRange: "~$24K/mo", trafficRange: "20K–40K visits/mo", activeAdsCount: 3, isHighTraffic: false,
        spottedAt: "2026-09-01T00:00:00.000Z", host: "paws.example.com",
        bestSellers: [1, 2, 3, 4].map((i) => ({ title: `Mat ${i}`, imageUrl: "", price: 30, estSalesRange: "1K–3K sold" })),
      });
      await ctx.db.insert("storeInspections", {
        userId, host: "paws.example.com", url: "https://paws.example.com", inspectedAt: "2026-10-10T00:00:00.000Z",
        result: { shopify: true, theme: { name: "Dawn" }, apps: [{ key: "judgeme", name: "Judge.me", category: "Reviews" }], pixels: [], teardown: null },
      });
      const adId = await ctx.db.insert("ads", ad({ landingHost: "paws.example.com" }));
      await ctx.db.insert("ads", ad({ landingHost: "paws.example.com", isActive: false }));
      const bareId = await ctx.db.insert("ads", ad({ landingPageUrl: "" }));
      return { adId, bareId };
    });
    const as = t.withIdentity({ subject: "u1|s" });
    const r = (await as.query(api.stores.forAd, { adId }))!;
    expect(r.host).toBe("paws.example.com");
    expect([r.adsLive, r.adsTracked]).toEqual([1, 2]);
    expect(r.store?.bestSellers).toHaveLength(3);
    expect(r.inspection?.theme).toBe("Dawn");
    expect(r.inspection?.apps.map((a) => a.name)).toEqual(["Judge.me"]);
    expect(await as.query(api.stores.forAd, { adId: bareId })).toBeNull();
  });
});
