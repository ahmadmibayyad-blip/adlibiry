import { describe, expect, it } from "vitest";
import { buildDashboard, buildNiches, buildTrends, isHomepageUrl, keywordsOf, type AdLite } from "./research";

const NOW = Date.parse("2026-09-30T08:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let shop = 0; // each ad from its own advertiser unless a test says otherwise
const ad = (title: string, d: number, over: Partial<AdLite> = {}): AdLite => ({
  title, niche: "Pet Supplies", platform: "TikTok", countries: ["US"], firstSeenAt: daysAgo(d), advertiser: `Shop ${shop++}`, ...over,
});

describe("keywords", () => {
  it("keeps product words and phrases, drops filler", () => {
    expect(keywordsOf("NEW Dog Cooling Mat - Free Shipping!")).toEqual(expect.arrayContaining(["cooling", "cooling mat", "dog cooling", "dog cooling mat"]));
    expect(keywordsOf("Shop now, limited offer")).toEqual([]);
  });
});

describe("buildTrends", () => {
  it("ranks what gained the most new ads this week", () => {
    const ads = [
      ...Array.from({ length: 6 }, () => ad("Dog cooling mat", 2)),
      ad("Dog cooling mat", 9),
      ...Array.from({ length: 3 }, () => ad("Posture corrector", 3, { niche: "Health & Wellness", countries: ["GB"] })),
      ...Array.from({ length: 4 }, () => ad("Posture corrector", 10, { niche: "Health & Wellness", countries: ["GB"] })),
      ad("Old lamp thing", 200),
    ];
    const rows = buildTrends(ads, NOW);
    // 6 of 9 new ads this week vs 1 of 5 the weeks before.
    expect(rows[0]).toMatchObject({ keyword: "dog cooling mat", niche: "Pet Supplies", direction: "Rising", risingPercent: 233 });
    expect(rows[0].insight).toBe("6 new ads this week, 67% of all new ads (20% the 4 weeks before), mostly on TikTok.");
    expect(rows[0].weeklyInterest).toHaveLength(12);
    expect(rows[0].weeklyInterest[11]).toBe(100);
    expect(rows[0].countryBreakdown[0]).toEqual({ country: "US", interest: 100 });
    // Words and shorter phrases inside a listed phrase aren't listed again.
    expect(rows.filter((r) => r.keyword.includes("cooling")).map((r) => r.keyword)).toEqual(["dog cooling mat"]);
    const posture = rows.find((r) => r.keyword === "posture corrector");
    expect(posture).toMatchObject({ direction: "Declining", risingPercent: -58 });
    expect(rows.some((r) => r.keyword.includes("lamp"))).toBe(false); // too old
  });

  it("keeps only phrases with recent ads, so 12 weeks of varied ads stay small", () => {
    const words = (i: number) => `item${i} thing${i % 997} model${i % 89} style${i % 13}`;
    const ads = [
      ...Array.from({ length: 30_000 }, (_, i) => ad(words(i), 15 + (i % 60))), // older weeks only
      ...Array.from({ length: 4 }, () => ad("Heated eye mask", 1)),
    ];
    const rows = buildTrends(ads, NOW);
    expect(rows.map((r) => r.keyword)).toEqual(["heated eye mask"]);
  });

  it("doesn't call everything rising when a week brings far more ads", () => {
    const ads = [
      ...Array.from({ length: 10 }, () => ad("Dog cooling mat", 9)),
      ...Array.from({ length: 90 }, (_, i) => ad(`Filler${i}`, 9)),
      ...Array.from({ length: 100 }, () => ad("Dog cooling mat", 2)), // 10x the ads, same 10% share
      ...Array.from({ length: 50 }, () => ad("Heated eye mask", 2)),
      ...Array.from({ length: 850 }, (_, i) => ad(`Item${i}`, 2)),
    ];
    const rows = buildTrends(ads, NOW);
    expect(rows[0]).toMatchObject({ keyword: "heated eye mask", direction: "Rising" });
    expect(rows.find((r) => r.keyword === "dog cooling mat")).toMatchObject({ direction: "Stable", risingPercent: 0 });
  });

  it("skips phrases from a single advertiser and ranks by new ads above usual", () => {
    const ads = [
      ...Array.from({ length: 20 }, () => ad("Synchro der Erbe Gummibärchen", 2, { advertiser: "Synchro" })),
      ...Array.from({ length: 4 }, (_, i) => ad("Heated eye mask", 1, { advertiser: `Shop ${i}` })),
      ...Array.from({ length: 2 }, () => ad("Heated eye mask", 1, { advertiser: "Shop 0" })),
    ];
    const rows = buildTrends(ads, NOW);
    expect(rows.map((r) => r.keyword)).toEqual(["heated eye mask"]);
    expect(rows[0].rank).toBe(0);
  });

  it("skips foreign-language ads and copies of one ad with no advertiser", () => {
    const ads = [
      ...Array.from({ length: 5 }, (_, i) => ad("Synchro und das nutzlose Erbe", 2, { advertiser: `Seite ${i}` })),
      ...Array.from({ length: 5 }, () => ad("Glod lys bar spar til", 2, { advertiser: undefined })),
      ...Array.from({ length: 3 }, (_, i) => ad(`Whey protein shake ${["vanilla", "cocoa", "berry"][i]}`, 2, { advertiser: undefined })),
    ];
    expect(buildTrends(ads, NOW).map((r) => r.keyword)).toEqual(["whey protein shake"]);
  });

  it("lists vague single words only inside a phrase", () => {
    const rows = buildTrends(Array.from({ length: 4 }, () => ad("Custom phone case", 1)), NOW);
    expect(rows.map((r) => r.keyword)).toEqual(["custom phone case"]);
    expect(keywordsOf("Custom case")).not.toContain("custom");
  });
});

describe("buildNiches", () => {
  it("summarises products and new ads per niche", () => {
    const rows = buildNiches(
      ["Pet Supplies", "Toys"],
      [
        { category: "Pet Supplies", aiScore: 80, winnerRank: 1, linkedAds: 2 },
        { category: "Pet Supplies", aiScore: 60 },
      ],
      [ad("Dog bed", 1), ad("Dog bed", 2), ad("Cat toy", 9), ad("Face serum", 10, { niche: "Beauty" })], // all new ads this week vs half last week
      NOW,
    );
    expect(rows).toHaveLength(1); // Toys has no products or ads
    expect(rows[0]).toMatchObject({ name: "Pet Supplies", icon: "PawPrint", avgAiScore: 70, productCount: 2, trendDirection: "Rising", topCountries: ["US"] });
    expect(rows[0].description).toBe("1 winner · 1 found in ads · 2 new ads this week (1 last week) · mostly TikTok.");
  });
});

describe("isHomepageUrl", () => {
  it("spots a bare site address", () => {
    expect(isHomepageUrl("https://www.aliexpress.com")).toBe(true);
    expect(isHomepageUrl("https://www.aliexpress.com/")).toBe(true);
    expect(isHomepageUrl("https://www.aliexpress.com/item/1.html")).toBe(false);
    expect(isHomepageUrl("https://www.aliexpress.com/?q=mat")).toBe(false);
  });
});

describe("buildDashboard", () => {
  it("counts new ads and products per day and ranks this week's niches", () => {
    const ads = [
      ad("a", 0), ad("b", 0), ad("c", 1),
      ad("d", 2, { niche: "Beauty" }),
      ad("e", 9, { niche: "Beauty" }), ad("f", 10, { niche: "Beauty" }),
      ad("g", 40),
    ];
    const d = buildDashboard(ads, [{ category: "Beauty", aiScore: 70, publishedAt: daysAgo(0) }, { category: "Beauty", aiScore: 70 }], NOW);
    expect(d.adsPerDay).toHaveLength(30);
    expect(d.adsPerDay[29]).toEqual({ day: "2026-09-30", value: 2 });
    expect(d.adsPerDay[28].value).toBe(1);
    expect(d.adsPerDay.reduce((s, p) => s + p.value, 0)).toBe(6); // the 40-day-old ad is outside
    expect(d.productsPerDay[29].value).toBe(1);
    expect(d.topNiches).toEqual([
      { niche: "Pet Supplies", thisWeek: 3, lastWeek: 0 },
      { niche: "Beauty", thisWeek: 1, lastWeek: 2 },
    ]);
  });
});
