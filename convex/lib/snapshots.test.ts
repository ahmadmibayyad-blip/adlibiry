import { describe, expect, it } from "vitest";
import { addDays, fillDays, shouldWriteSnapshot } from "./snapshots";

const v = { score: 50, adsRunning: 1, views: 100, likes: 1, comments: 0, spend: 0, gmv: 0 };

describe("snapshot rules", () => {
  it("writes the first row, any change, and a refresh after 30 days; skips unchanged days", () => {
    expect(shouldWriteSnapshot(null, "2026-10-01", v)).toBe(true);
    expect(shouldWriteSnapshot({ day: "2026-10-01", ...v }, "2026-10-02", v)).toBe(false);
    expect(shouldWriteSnapshot({ day: "2026-10-01", ...v }, "2026-10-02", { ...v, views: 101 })).toBe(true);
    expect(shouldWriteSnapshot({ day: "2026-10-01", ...v }, "2026-10-02", { ...v, trend: "Rising" })).toBe(true);
    expect(shouldWriteSnapshot({ day: "2026-09-01", ...v }, "2026-10-01", v)).toBe(true);
  });

  it("fills skipped days with the last known values", () => {
    const rows = [{ day: "2026-10-03", views: 100 }, { day: "2026-10-05", views: 160 }];
    expect(fillDays(null, rows, "2026-10-01", "2026-10-06").map((r) => [r.day, r.views])).toEqual([
      ["2026-10-03", 100], ["2026-10-04", 100], ["2026-10-05", 160], ["2026-10-06", 160],
    ]);
  });

  it("starts the window from the row before it", () => {
    expect(fillDays({ day: "2026-09-01", views: 7 }, [], "2026-10-01", "2026-10-03").map((r) => [r.day, r.views])).toEqual([
      ["2026-10-01", 7], ["2026-10-02", 7], ["2026-10-03", 7],
    ]);
    expect(fillDays(null, [], "2026-10-01", "2026-10-03")).toEqual([]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
