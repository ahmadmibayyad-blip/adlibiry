import { describe, expect, it } from "vitest";
import { adSpend, clampCpm, DEFAULT_CPM, formatUsd, spendFromReach } from "./euSpend.ts";
import { estimatedSpendUsd } from "@/convex/lib/euSpend.ts";
import { spendLabel } from "./adFormat.ts";

describe("EU spend estimate", () => {
  it("is reach / 1000 x CPM, $9 by default (matches Minea's live numbers)", () => {
    expect(DEFAULT_CPM).toBe(9);
    expect(spendFromReach(842)).toBeCloseTo(7.578);
    expect(spendFromReach(21_974_583)).toBeCloseTo(197_771.247);
    expect(spendFromReach(842, 18)).toBeCloseTo(15.156);
  });

  it("has no estimate without reach", () => {
    expect(spendFromReach(undefined)).toBeUndefined();
    expect(spendFromReach(0)).toBeUndefined();
    expect(spendFromReach(-5)).toBeUndefined();
  });

  it("keeps the CPM in a sane range", () => {
    expect(clampCpm("abc")).toBe(DEFAULT_CPM);
    expect(clampCpm(0)).toBe(1);
    expect(clampCpm(500)).toBe(100);
    expect(clampCpm("12.345")).toBe(12.35);
  });

  it("filters and sorts by the same figure the card shows", () => {
    expect(estimatedSpendUsd({ spendEstimate: "$5K–$10K", audience: { totalReach: 10_000 } }, 9)).toBeCloseTo(90);
    expect(estimatedSpendUsd({ spendEstimate: "$5K–$10K" }, 9)).toBe(10_000);
    expect(estimatedSpendUsd({ spendEstimate: "Unknown" }, 9)).toBeUndefined();
  });

  it("formats dollars compactly", () => {
    expect(formatUsd(7.578)).toBe("$7.58");
    expect(formatUsd(1234)).toBe("$1.2K");
    expect(formatUsd(197_771)).toBe("$198K");
    expect(formatUsd(2_500_000)).toBe("$2.5M");
  });

  it("prefers EU reach over the source's own figure, and falls back to it", () => {
    const withReach = adSpend({ spendEstimate: "$5K–$10K (AdLibrary est.)", audience: { totalReach: 10_000 } }, 9, spendLabel);
    expect(withReach).toMatchObject({ value: "$90", basis: "eu-reach", note: "EU reach 10,000 × $9 CPM" });
    const noReach = adSpend({ spendEstimate: "$5K–$10K (AdLibrary est.)" }, 9, spendLabel);
    expect(noReach).toMatchObject({ value: "$5K–$10K", basis: "source" });
    expect(adSpend({ spendEstimate: "Unknown" }, 9, spendLabel)).toBeNull();
  });
});
