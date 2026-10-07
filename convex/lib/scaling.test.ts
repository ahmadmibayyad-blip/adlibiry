import { describe, expect, it } from "vitest";
import { engagementRate, isScaling, median } from "./scaling";

describe("Scaling ads", () => {
  it("needs 14+ days and either growing views or above-median engagement", () => {
    expect(isScaling({ daysRunning: 10, viewsNow: 2000, viewsWeekAgo: 1000 })).toBe(false); // too new
    expect(isScaling({ daysRunning: 20, viewsNow: 1150, viewsWeekAgo: 1000 })).toBe(true); // +15% in a week
    expect(isScaling({ daysRunning: 20, viewsNow: 1050, viewsWeekAgo: 1000 })).toBe(false); // +5%
    expect(isScaling({ daysRunning: 20, viewsNow: 1000, engagement: 0.04, nicheMedianEngagement: 0.03 })).toBe(true);
    expect(isScaling({ daysRunning: 20, viewsNow: 1000, engagement: 0.02, nicheMedianEngagement: 0.03 })).toBe(false);
    expect(isScaling({ daysRunning: 20, viewsNow: 1000 })).toBe(false); // no history, no engagement
  });

  it("works out engagement and medians", () => {
    expect(engagementRate({ likes: 30, comments: 10, views: 1000 })).toBe(0.04);
    expect(engagementRate({ likes: 30, views: 0 })).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});
