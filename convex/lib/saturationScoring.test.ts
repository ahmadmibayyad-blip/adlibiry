import { describe, expect, it } from "vitest";
import {
  clamp,
  computeOpportunityScore,
  demandLabel,
  opportunityLabel,
  parseCompactNumber,
  recencyWeight,
  saturationCurve,
  saturationLabel,
  scoreCountry,
  weightedAverage,
} from "./saturationScoring";

describe("saturationCurve", () => {
  it("returns 0 for no competitors", () => {
    expect(saturationCurve(0, 6)).toBe(0);
    expect(saturationCurve(-3, 6)).toBe(0);
  });

  it("returns 50 at the half-saturation point", () => {
    expect(saturationCurve(6, 6)).toBe(50);
  });

  it("approaches but never exceeds 100 as n grows", () => {
    expect(saturationCurve(1000, 6)).toBeLessThan(100);
    expect(saturationCurve(1000, 6)).toBeGreaterThan(95);
  });
});

describe("parseCompactNumber", () => {
  it("parses plain numbers", () => {
    expect(parseCompactNumber("500")).toBe(500);
  });

  it("parses K/M/B suffixes", () => {
    expect(parseCompactNumber("540K")).toBe(540_000);
    expect(parseCompactNumber("2.4M")).toBe(2_400_000);
    expect(parseCompactNumber("1.1B")).toBe(1_100_000_000);
  });

  it("is case-insensitive", () => {
    expect(parseCompactNumber("8.3m")).toBeCloseTo(8_300_000, 5);
  });

  it("returns 0 for unparseable input", () => {
    expect(parseCompactNumber("unknown")).toBe(0);
    expect(parseCompactNumber("")).toBe(0);
  });
});

describe("recencyWeight", () => {
  const now = new Date("2026-01-01T00:00:00Z").getTime();

  it("weights activity within 30 days highest", () => {
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString();
    expect(recencyWeight(tenDaysAgo, now)).toBe(1.5);
  });

  it("weights activity within 90 days moderately", () => {
    const sixtyDaysAgo = new Date(now - 60 * 86_400_000).toISOString();
    expect(recencyWeight(sixtyDaysAgo, now)).toBe(1.0);
  });

  it("weights old activity lowest", () => {
    const yearAgo = new Date(now - 365 * 86_400_000).toISOString();
    expect(recencyWeight(yearAgo, now)).toBe(0.5);
  });
});

describe("clamp", () => {
  it("keeps values within range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe("weightedAverage", () => {
  it("ignores unavailable (null) components entirely", () => {
    const result = weightedAverage([
      { name: "a", score: 80, weight: 0.5 },
      { name: "b", score: null, weight: 0.5 },
    ]);
    // Only "a" counted, so result should equal its own score, not diluted by "b".
    expect(result).toBe(80);
  });

  it("returns 0 when no components have data", () => {
    expect(weightedAverage([{ name: "a", score: null, weight: 1 }])).toBe(0);
  });

  it("computes a proper weighted average when all data is present", () => {
    const result = weightedAverage([
      { name: "a", score: 100, weight: 1 },
      { name: "b", score: 0, weight: 1 },
    ]);
    expect(result).toBe(50);
  });
});

describe("computeOpportunityScore", () => {
  it("scores high demand + low saturation as a strong opportunity", () => {
    const score = computeOpportunityScore(84, 19);
    expect(score).toBeGreaterThan(80);
  });

  it("scores low demand + low saturation as a weak opportunity, not a great one", () => {
    // This is the exact flaw the feature must avoid: 0 competitors with 0 demand
    // must NOT look like a great product.
    const score = computeOpportunityScore(5, 5);
    expect(score).toBeLessThan(55);
  });

  it("scores high demand + high saturation as a middling opportunity", () => {
    const score = computeOpportunityScore(90, 85);
    expect(score).toBeLessThan(60);
  });

  it("never returns a value outside 0-100", () => {
    expect(computeOpportunityScore(100, 0)).toBeLessThanOrEqual(100);
    expect(computeOpportunityScore(0, 100)).toBeGreaterThanOrEqual(0);
  });
});

describe("score labels", () => {
  it("maps saturation score ranges to labels", () => {
    expect(saturationLabel(5)).toBe("Almost no competition");
    expect(saturationLabel(95)).toBe("Oversaturated");
  });

  it("maps demand score ranges to labels", () => {
    expect(demandLabel(10)).toBe("Almost no visible demand");
    expect(demandLabel(90)).toBe("Extremely strong demand");
  });

  it("maps opportunity score ranges to labels", () => {
    expect(opportunityLabel(10)).toBe("Poor opportunity");
    expect(opportunityLabel(90)).toBe("Early-mover opportunity");
  });
});

describe("scoreCountry", () => {
  const now = new Date("2026-01-01T00:00:00Z").getTime();
  const recentIso = new Date(now - 5 * 86_400_000).toISOString();
  const oldIso = new Date(now - 300 * 86_400_000).toISOString();

  it("scores a country with no tracked data as low saturation and low demand, not a hidden opportunity", () => {
    const result = scoreCountry({
      localAds: [],
      globalAdvertiserCount: 0,
      localStores: [],
      hasTrendData: false,
      hasSupplierData: false,
      now,
    });
    expect(result.saturationScore).toBe(0);
    expect(result.demandScore).toBe(0);
    // The exact flaw the feature must avoid: 0 competitors + 0 demand must not
    // look like a great opportunity.
    expect(result.opportunityScore).toBeLessThan(60);
    expect(result.confidenceScore).toBeLessThan(100);
  });

  it("deduplicates advertisers by name rather than counting raw ads", () => {
    const result = scoreCountry({
      localAds: [
        { advertiserName: "Acme", firstSeenAt: recentIso, views: "10K" },
        { advertiserName: "Acme", firstSeenAt: recentIso, views: "5K" },
        { advertiserName: "Bolt", firstSeenAt: recentIso, views: "1K" },
      ],
      globalAdvertiserCount: 2,
      localStores: [],
      hasTrendData: false,
      hasSupplierData: false,
      now,
    });
    expect(result.signals.localAdvertiserCount).toBe(2);
    expect(result.signals.localActiveAds).toBe(3);
  });

  it("weights recent advertisers more heavily than old ones in the recent-30d count", () => {
    const result = scoreCountry({
      localAds: [
        { advertiserName: "Recent", firstSeenAt: recentIso, views: "1K" },
        { advertiserName: "Old", firstSeenAt: oldIso, views: "1K" },
      ],
      globalAdvertiserCount: 2,
      localStores: [],
      hasTrendData: false,
      hasSupplierData: false,
      now,
    });
    expect(result.signals.recentLocalAdvertisers30d).toBe(1);
  });

  it("reports unavailable sources and lowers confidence without dragging scores to 0", () => {
    const result = scoreCountry({
      localAds: [{ advertiserName: "Acme", firstSeenAt: recentIso, views: "1M" }],
      globalAdvertiserCount: 1,
      localStores: [],
      trendCountryInterest: 80,
      hasTrendData: true,
      hasSupplierData: false,
      now,
    });
    expect(result.signals.sourcesUnavailable).toContain("Supplier data (no tracked listings for this niche)");
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeLessThan(100);
    expect(result.demandScore).toBeGreaterThan(0);
  });
});
