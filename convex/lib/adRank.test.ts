import { describe, expect, it } from "vitest";
import { rankAdvertiserAds, rankTrend } from "./adRank";
import { shouldWriteSnapshot } from "./snapshots";

describe("rankAdvertiserAds", () => {
  it("ranks live ads by views, longer running first on a tie", () => {
    const r = rankAdvertiserAds([
      { id: "a", views: 100, daysRunning: 3 },
      { id: "b", views: 500, daysRunning: 1, isActive: true },
      { id: "c", views: 100, daysRunning: 9 },
      { id: "d", views: 9999, daysRunning: 30, isActive: false },
    ]);
    expect(Object.fromEntries(r)).toEqual({ b: { rank: 1, of: 3 }, c: { rank: 2, of: 3 }, a: { rank: 3, of: 3 } });
  });

  it("is empty when nothing is live", () => {
    expect(rankAdvertiserAds([{ id: "a", views: 1, daysRunning: 1, isActive: false }]).size).toBe(0);
  });
});

describe("rankTrend", () => {
  it("compares the first and last ranked day", () => {
    expect(rankTrend([{ rank: 5 }, {}, { rank: 2 }])).toBe("rising");
    expect(rankTrend([{ rank: 1 }, { rank: 3 }])).toBe("falling");
    expect(rankTrend([{ rank: 2 }, { rank: 4 }, { rank: 2 }])).toBe("steady");
    expect(rankTrend([{ rank: 2 }, {}])).toBeUndefined();
  });
});

describe("rank in daily snapshots", () => {
  it("writes a new row when only the rank changed", () => {
    const prev = { day: "2026-10-01", score: 70, views: 10, rank: 2, rankOf: 5 };
    expect(shouldWriteSnapshot(prev, "2026-10-02", { score: 70, views: 10, rank: 2, rankOf: 5 })).toBe(false);
    expect(shouldWriteSnapshot(prev, "2026-10-02", { score: 70, views: 10, rank: 1, rankOf: 5 })).toBe(true);
    expect(shouldWriteSnapshot(prev, "2026-10-02", { score: 70, views: 10, rank: undefined, rankOf: undefined })).toBe(true);
  });
});
