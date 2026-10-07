import { describe, expect, it } from "vitest";
import { HISTOGRAM_BINS, binOf, medianOf, percentileOf, rawScore, scoreFromPercentile, scoreParts, shareAtLeast } from "./productScore";
import { passesWinnerGates } from "./winnerGates";
import { pointEstimate, revenueConfidence } from "./estimates";

describe("score parts", () => {
  it("rewards live ads, sales, rising trend, low competition and margin", () => {
    const strong = scoreParts({ activeAds: 20, medianDaysRunning: 45, sourceScore: 80, revenuePerMonth: 200_000, growthPercent: 60, saturation: "Low", marginPercent: 55 });
    const weak = scoreParts({ activeAds: 1, medianDaysRunning: 3, sourceScore: 20, revenuePerMonth: 1_500, growthPercent: -20, saturation: "High", marginPercent: 10 });
    for (const k of Object.keys(strong) as (keyof typeof strong)[]) expect(strong[k]).toBeGreaterThan(weak[k]);
    expect(rawScore(strong)).toBeGreaterThan(0.7);
    expect(rawScore(weak)).toBeLessThan(0.25);
  });

  it("treats unknown data as middling, not as top marks", () => {
    const unknown = scoreParts({ activeAds: 0 });
    expect(unknown).toMatchObject({ saturation: 50, margin: 50 });
    expect(unknown.revenue).toBeLessThan(30);
  });
});

describe("calibration", () => {
  it("maps percentiles to the target spread", () => {
    expect(scoreFromPercentile(0.5)).toBe(45);
    expect(scoreFromPercentile(0.8)).toBe(70);
    expect(scoreFromPercentile(0.95)).toBe(85);
    expect(scoreFromPercentile(0.985)).toBeLessThan(92);
    expect(scoreFromPercentile(1)).toBe(99);
  });

  it("turns any raw distribution into median ≈45, 20% at 70+, 5% at 85+", () => {
    // A skewed catalog: most raw scores near the top (like the old 99–100 cluster).
    const raws = Array.from({ length: 2000 }, (_, i) => 0.6 + 0.4 * Math.sqrt(i / 2000));
    const hist = new Array(HISTOGRAM_BINS).fill(0);
    for (const r of raws) hist[binOf(r)]++;
    const scores = new Array(101).fill(0);
    for (const r of raws) scores[scoreFromPercentile(percentileOf(r, hist))]++;
    expect(medianOf(scores)).toBeGreaterThanOrEqual(43);
    expect(medianOf(scores)).toBeLessThanOrEqual(47);
    expect(shareAtLeast(scores, 70)).toBeGreaterThan(0.17);
    expect(shareAtLeast(scores, 70)).toBeLessThan(0.23);
    expect(shareAtLeast(scores, 85)).toBeGreaterThan(0.03);
    expect(shareAtLeast(scores, 85)).toBeLessThan(0.07);
    expect(shareAtLeast(scores, 90)).toBeLessThan(0.03);
  });
});

describe("winner gates", () => {
  const ok = { revenuePerMonth: 25_000, activeAds: 4, momentum14: 5, saturation: "Medium" };
  it("needs sales, live ads, momentum that isn't falling and room in the market", () => {
    expect(passesWinnerGates(ok)).toEqual({ ok: true });
    expect(passesWinnerGates({ ...ok, revenuePerMonth: 2_900 })).toEqual({ ok: false, reason: "revenue" });
    expect(passesWinnerGates({ ...ok, revenuePerMonth: undefined })).toEqual({ ok: false, reason: "revenue" });
    expect(passesWinnerGates({ ...ok, activeAds: 2 })).toEqual({ ok: false, reason: "ads" });
    expect(passesWinnerGates({ ...ok, momentum14: -3 })).toEqual({ ok: false, reason: "momentum" });
    expect(passesWinnerGates({ ...ok, momentum14: undefined })).toEqual({ ok: true }); // not enough history yet
    expect(passesWinnerGates({ ...ok, saturation: "High" })).toEqual({ ok: false, reason: "saturation" });
  });
});

describe("one revenue number with a confidence label", () => {
  it("uses the middle of the range and says how sure we are", () => {
    expect(pointEstimate({ low: 418_300, high: 1_300_000 })).toBe(737_421);
    expect(pointEstimate(undefined)).toBeUndefined();
    expect(pointEstimate({ low: 0, high: 0 })).toBeUndefined();
    expect(revenueConfidence("marketplace_sales")).toBe("High");
    expect(revenueConfidence("reported_gmv")).toBe("Medium");
    expect(revenueConfidence("ad_funnel")).toBe("Low");
    expect(revenueConfidence(undefined)).toBeUndefined();
  });
});

describe("known-data gates", () => {
  it("lets missing data through but not bad numbers", async () => {
    const { passesKnownGates } = await import("./winnerGates");
    expect(passesKnownGates({ revenuePerMonth: undefined, activeAds: undefined })).toBe(true);
    expect(passesKnownGates({ revenuePerMonth: 2_000 })).toBe(false);
    expect(passesKnownGates({ activeAds: 1 })).toBe(false);
    expect(passesKnownGates({ momentum14: -5 })).toBe(false);
    expect(passesKnownGates({ saturation: "High" })).toBe(false);
  });
});
