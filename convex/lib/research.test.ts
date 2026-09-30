import { describe, expect, it } from "vitest";
import { buildNiches, buildTrends, isHomepageUrl, keywordsOf, type AdLite } from "./research";

const NOW = Date.parse("2026-09-30T08:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ad = (title: string, d: number, over: Partial<AdLite> = {}): AdLite => ({
  title, niche: "Pet Supplies", platform: "TikTok", countries: ["US"], firstSeenAt: daysAgo(d), ...over,
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
    expect(rows[0]).toMatchObject({ keyword: "dog cooling mat", niche: "Pet Supplies", direction: "Rising", risingPercent: 500 });
    expect(rows[0].weeklyInterest).toHaveLength(12);
    expect(rows[0].weeklyInterest[11]).toBe(100);
    expect(rows[0].countryBreakdown[0]).toEqual({ country: "US", interest: 100 });
    // Words and shorter phrases inside a listed phrase aren't listed again.
    expect(rows.filter((r) => r.keyword.includes("cooling")).map((r) => r.keyword)).toEqual(["dog cooling mat"]);
    const posture = rows.find((r) => r.keyword === "posture corrector");
    expect(posture).toMatchObject({ direction: "Declining", risingPercent: -25 });
    expect(rows.some((r) => r.keyword.includes("lamp"))).toBe(false); // too old
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
      [ad("Dog bed", 1), ad("Dog bed", 2), ad("Cat toy", 9)],
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
