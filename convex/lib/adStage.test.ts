import { describe, expect, it } from "vitest";
import { adStage } from "./adStage";

const ad = { daysRunning: 20, spendEstimate: "$200–$500", views: "40K" };

describe("adStage", () => {
  it("keeps Scaling ahead of the other stages", () => {
    expect(adStage({ ...ad, isScaling: true })).toBe("scaling");
  });

  it("calls an ad Winning after 7 days with $100+ estimated spend", () => {
    expect(adStage(ad)).toBe("winning");
    expect(adStage({ ...ad, spendEstimate: "~$100 (impression-based est.)" })).toBe("winning");
    expect(adStage({ ...ad, spendEstimate: "$20–$90" })).toBeUndefined();
    expect(adStage({ ...ad, daysRunning: 7 })).toBe("testing");
  });

  it("calls new or barely seen live ads Testing", () => {
    expect(adStage({ daysRunning: 2, spendEstimate: "Unknown", views: "0" })).toBe("testing");
    expect(adStage({ daysRunning: 30, spendEstimate: "Unknown", impressions: 400 })).toBe("testing");
    expect(adStage({ daysRunning: 30, spendEstimate: "Unknown", views: "12K" })).toBeUndefined();
  });

  it("gives stopped ads no stage", () => {
    expect(adStage({ ...ad, isActive: false, isScaling: true })).toBeUndefined();
    expect(adStage({ ...ad, isActive: false, daysRunning: 1 })).toBeUndefined();
  });
});
