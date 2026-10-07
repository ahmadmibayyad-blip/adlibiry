import { describe, expect, it } from "vitest";
import { backfillTerm, budgetLeft, entrantSpikes, fuseAd, fusion, isVerifiedWinner, mayOverwritePrice, parseCount } from "./fusion";

const DAY = "2026-10-07";

describe("fuseAd: field priorities", () => {
  it("records every source and who wrote each field group", () => {
    const f = fuseAd(null, { isActive: true, advertiserName: "Corecare", views: "12K" }, "meta_ad_library", DAY);
    expect(f.sources).toEqual(["meta_ad_library"]);
    expect(f.sourceFields).toMatchObject({ live: { source: "meta_ad_library", at: DAY }, advertiser: { source: "meta_ad_library" } });
  });

  it("keeps the official live status and page name, takes the scraper's engagement, and logs the disagreement", () => {
    const existing = { source: "meta_ad_library", isActive: true, advertiserName: "Corecare", views: "0", daysRunning: 30 };
    const f = fuseAd(existing, { isActive: false, advertiserName: "Corecareshop", views: "48K", likes: 900 }, "apify", DAY);
    expect(f.drop).toEqual(expect.arrayContaining(["isActive", "advertiserName"]));
    expect(f.drop).not.toContain("views");
    expect(f.sources).toEqual(["meta_ad_library", "apify"]);
    expect(f.sourceFields.engagement?.source).toBe("apify");
    expect(f.sourceFields.live?.source).toBeUndefined(); // still the ad's own (official) source
    expect(f.conflicts.map((c) => c.field).sort()).toEqual(["advertiser", "live"]);
  });

  it("lets the official registry overwrite a scraper's live status, and never overwrites numbers with zeros", () => {
    const existing = { source: "apify", isActive: true, views: "48K", likes: 900, daysRunning: 30 };
    const f = fuseAd(existing, { isActive: false, views: "0", likes: 0 }, "meta_ad_library", DAY);
    expect(f.drop).not.toContain("isActive");
    expect(f.drop).toEqual(expect.arrayContaining(["views", "likes"]));
    expect(f.sourceFields.live?.source).toBe("meta_ad_library");
    expect(f.conflicts.map((c) => c.field)).toEqual(["live"]); // logged even though the registry won
  });

  it("flags engagement the ad's age can't explain", () => {
    const f = fuseAd(null, { views: "2.1M", daysRunning: 3 }, "apify", DAY);
    expect(f.conflicts[0]).toMatchObject({ field: "engagement_vs_age" });
  });

  it("parses compact counts", () => {
    expect(parseCount("1.2M")).toBe(1_200_000);
    expect(parseCount("35K")).toBe(35_000);
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount(undefined)).toBe(0);
  });
});

describe("price provenance", () => {
  it("prefers the store's own page over market data over ad text", () => {
    expect(mayOverwritePrice("landing_page", "exact")).toBe(false);
    expect(mayOverwritePrice("exact", "landing_page")).toBe(true);
    expect(mayOverwritePrice("ad_data", "exact")).toBe(true);
    expect(mayOverwritePrice(undefined, "ad_data")).toBe(true);
  });
});

describe("agreement across source families", () => {
  const base = { productSource: "ads", activeAds: 4, marginKnown: true, saturation: "Low", ads: [] };

  it("counts independent families, not sources", () => {
    const f = fusion({ ...base, ads: [{ sources: ["apify", "pipispy"] }] });
    expect(f.families).toEqual(["engagement"]);
    expect(f.confidence).toBe(20);
  });

  it("is cross-validated when the registry, scrapers and marketplace all agree", () => {
    const f = fusion({
      ...base,
      productSource: "tiktok_shop",
      unitsPerMonth: 4000,
      ads: [{ sources: ["meta_ad_library", "apify"], isActive: true, isScaling: true }],
    });
    expect(f).toMatchObject({ families: ["engagement", "marketplace", "registry"], adLevel: true, productLevel: true, crossValidated: true });
    expect(f.confidence).toBe(100);
    expect(isVerifiedWinner(true, f)).toBe(true);
    expect(isVerifiedWinner(false, f)).toBe(false);
  });

  it("isn't cross-validated without a known margin or with crowded competition", () => {
    const ads = [{ sources: ["meta_ad_library"], isActive: true, isScaling: true }];
    expect(fusion({ ...base, productSource: "shopify", unitsPerMonth: 500, ads, marginKnown: false }).crossValidated).toBe(false);
    expect(fusion({ ...base, productSource: "shopify", unitsPerMonth: 500, ads, saturation: "Medium" }).crossValidated).toBe(false);
  });

  it("needs the official registry to call an ad live", () => {
    const f = fusion({ ...base, ads: [{ sources: ["apify"], isActive: true, isScaling: true }] });
    expect(f.adLevel).toBe(false);
  });
});

describe("triggers", () => {
  it("spots a niche whose advertisers doubled with at least 5 newcomers", () => {
    const spikes = entrantSpikes({ "Pet Supplies|DE": 12, "Beauty|DE": 6, "Toys|US": 40 }, { "Pet Supplies|DE": 5, "Beauty|DE": 3, "Toys|US": 35 });
    expect(spikes).toEqual([{ key: "Pet Supplies|DE", now: 12, before: 5 }]);
    expect(entrantSpikes({ "New|DK": 10 }, {})).toEqual([]); // no baseline yet
  });

  it("searches a shop by its brand and a marketplace item by its title", () => {
    expect(backfillTerm({ title: "Posture Corrector", storeHost: "www.corecareshop.com" })).toBe("corecareshop");
    expect(backfillTerm({ title: "[Medicube] Zero Pore Pads (70 pcs) for Oily Skin", storeHost: "amazon.com" })).toBe("Zero Pore Pads Oily");
  });

  it("keeps a budget", () => {
    expect(budgetLeft(9.93, 10)).toBe(0.07);
    expect(budgetLeft(12, 10)).toBe(0);
  });
});
