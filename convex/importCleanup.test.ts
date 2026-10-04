/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const row = (i: number, firstSeenAt: string) => ({
  externalId: `csv:adv${i}|https://img/${i}.jpg`, source: "csv_import", advertiserName: `adv${i}`,
  platform: "Facebook", country: "US", niche: "Other", headline: `Ad ${i}`, bodyText: "", creativeUrl: `https://img/${i}.jpg`,
  landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 0, aiScore: 1, firstSeenAt,
});

describe("remove last ad CSV import", () => {
  it("deletes only the newest import, in batches", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
    const admin = t.withIdentity({ subject: "a|s" });
    const OLD = "2026-10-01T00:00:00.000Z";
    const NEW = "2026-10-03T00:00:00.000Z";
    await admin.mutation(api.admin.externalImport.importAds, { ads: [1, 2].map((i) => row(i, OLD)), refreshFirstSeen: true });
    for (let b = 0; b < 3; b++) {
      const ads = Array.from({ length: 100 }, (_, k) => row(100 + b * 100 + k, NEW)).slice(0, b === 2 ? 50 : 100);
      await admin.mutation(api.admin.externalImport.importAds, { ads, refreshFirstSeen: true });
    }

    expect(await admin.query(api.admin.importCleanup.lastAdImport, {})).toEqual({ at: NEW, count: 250 });
    expect(await admin.mutation(api.admin.importCleanup.removeAdImport, { at: NEW })).toEqual({ deleted: 200, remaining: 50 });
    expect(await admin.mutation(api.admin.importCleanup.removeAdImport, { at: NEW })).toEqual({ deleted: 50, remaining: 0 });

    const left = await t.run(async (ctx) => ({
      ads: (await ctx.db.query("ads").collect()).map((a) => a.firstSeenAt),
      links: (await ctx.db.query("syncLinks").collect()).length,
    }));
    expect(left.ads).toEqual([OLD, OLD]);
    expect(left.links).toBe(2);
    expect(await admin.query(api.admin.importCleanup.lastAdImport, {})).toEqual({ at: OLD, count: 2 });
  });

  it("is admin only", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u", role: "user" }));
    await expect(t.withIdentity({ subject: "u|s" }).query(api.admin.importCleanup.lastAdImport, {})).rejects.toThrow();
  });
});

describe("remove empty CSV ads", () => {
  it("deletes product listings and ads with no numbers, keeps the rest", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
    const admin = t.withIdentity({ subject: "a|s" });
    const listing = (i: number) => ({
      ...row(i, "2026-10-03T00:00:00.000Z"),
      bodyText: "Product Price: $76.48 · Product Rating: 4.3 · Items Sold (Last 7 days): 6 · Total GMV: $22,477.40",
    });
    const realAd = { ...row(900, "2026-10-03T00:00:00.000Z"), bodyText: "Keep your dog cool", likes: 1500 };
    // Same text but with engagement: a real ad, kept.
    const withViews = { ...listing(901), views: "10K", impressions: 10_000 };
    // No numbers at all (a file without likes, views or dates): removed too.
    const empty = { ...row(902, "2026-10-03T00:00:00.000Z"), bodyText: "Pet insurance from $16" };
    // Running for 30 days but no engagement: has data, kept.
    const running = { ...row(903, "2026-10-03T00:00:00.000Z"), bodyText: "Dog food", daysRunning: 30 };
    const ads = [...Array.from({ length: 250 }, (_, i) => listing(i)), realAd, withViews, empty, running];
    for (let i = 0; i < ads.length; i += 100) {
      await admin.mutation(api.admin.externalImport.importAds, { ads: ads.slice(i, i + 100), refreshFirstSeen: true });
    }

    let cursor: string | null = null;
    let deleted = 0;
    for (;;) {
      const r: { deleted: number; cursor: string; isDone: boolean } = await admin.mutation(api.admin.importCleanup.removeProductListingAds, { cursor });
      deleted += r.deleted;
      if (r.isDone) break;
      cursor = r.cursor;
    }
    expect(deleted).toBe(251);
    const left = await t.run(async (ctx) => (await ctx.db.query("ads").collect()).map((a) => a.headline).sort());
    expect(left).toEqual(["Ad 900", "Ad 901", "Ad 903"]);
  });
});

describe("product import with sales columns", () => {
  it("saves orders per month, GMV and a revenue estimate", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
    await t.withIdentity({ subject: "a|s" }).mutation(api.admin.productImport.importProducts, {
      rows: [{
        title: "Truck Floor Mats", imageUrl: "https://x/mat.webp", productUrl: "https://www.tiktok.com/shop/pdp/1", category: "Automotive",
        priceUsd: 76.48, unitsPerMonth: 30, totalGmv: 22477.4, rating: 4.3, reviews: 25,
      }],
    });
    const p = await t.run(async (ctx) => (await ctx.db.query("products").collect())[0]);
    expect(p).toMatchObject({ unitsPerMonth: 30, linkedGmv: 22477, estBasis: { revenue: "marketplace_sales" } });
    expect(p.estRevenue).toEqual({ low: Math.round(30 * 76.48 * 0.7), high: Math.round(30 * 76.48 * 1.3) });
    expect(p.description).toContain("~30 sold/month");
    expect(p.aiScore).toBeGreaterThan(1);
  });
});
