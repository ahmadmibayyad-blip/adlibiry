/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
  return { t, admin: t.withIdentity({ subject: "a|s" }) };
}

const ad = (i: number, platform: string) => ({
  source: "csv_import", advertiserName: `adv${i}`, platform, country: "US", niche: "Other", headline: `Ad ${i}`, bodyText: "",
  creativeUrl: `https://img/${i}.jpg`, landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 0, aiScore: 1,
  targeting: { ageRange: "18-65", gender: "All", interests: [] },
  firstSeenAt: "2026-10-18T00:00:00.000Z",
});

const prow = (i: number) => ({ title: `Product ${i}`, imageUrl: `https://img/p${i}.jpg`, productUrl: `https://shop.tiktok.com/view/product/${i}`, category: "Beauty", priceUsd: 20, unitsPerMonth: 100 * i });

describe("Admin → Ads platform filter", () => {
  it("lists only the chosen platform's ads", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      for (const [i, p] of [[1, "Facebook"], [2, "TikTok"], [3, "Instagram"], [4, "TikTok"]] as const) await ctx.db.insert("ads", ad(i, p));
    });
    const tiktok = await admin.query(api.admin.ads.listAds, { platform: "TikTok", paginationOpts: { numItems: 20, cursor: null } });
    expect(tiktok.page.map((a) => a.advertiserName).sort()).toEqual(["adv2", "adv4"]);
    const all = await admin.query(api.admin.ads.listAds, { paginationOpts: { numItems: 20, cursor: null } });
    expect(all.page).toHaveLength(4);
  });
});

describe("TikTok product CSV → TikTok Shop", () => {
  it("lands on TikTok Shop → Best sellers and can be undone like any CSV import", async () => {
    const { t, admin } = await setup();
    // Products 1 and 9 came in earlier from a plain CSV; the TikTok import moves product 1 onto the TikTok Shop page.
    await admin.mutation(api.admin.productImport.importProducts, { rows: [prow(1), prow(9)], source: "CSV" });
    await admin.mutation(api.admin.productImport.importProducts, { rows: [1, 2, 3].map(prow), source: "Kalodata", sourceKey: "tiktok_shop" });

    const best = await admin.query(api.products.tiktokShop, { paginationOpts: { numItems: 10, cursor: null } });
    expect(best.page.map((p) => p.title)).toEqual(["Product 3", "Product 2", "Product 1"]);

    const last = await admin.query(api.admin.importCleanup.lastProductImport, {});
    expect(last?.name).toBe("Kalodata");
    const r = await admin.mutation(api.admin.importCleanup.removeProductImport, { name: "Kalodata", before: last!.at + 1 });
    expect(r.deleted).toBe(2); // product 1 was only updated by it, so it stays
    expect((await t.run((ctx) => ctx.db.query("products").collect())).map((p) => p.title)).toEqual(["Product 1", "Product 9"]);
  });
});
