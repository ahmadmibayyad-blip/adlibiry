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

  it("uses the EU reach spend at the user's CPM when the ad has EU reach", () => {
    const eu = { daysRunning: 20, spendEstimate: "Unknown", views: "40K", audience: { totalReach: 10_000 } };
    expect(adStage(eu, 9)).toBeUndefined(); // 10K reach × $9 CPM = $90
    expect(adStage(eu, 11)).toBe("winning"); // × $11 = $110
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
