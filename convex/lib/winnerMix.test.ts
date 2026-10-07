import { describe, expect, it } from "vitest";
import { addDays, daysBetween, pickNicheMix, seededRandom } from "./winnerMix";

const products = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: `p${i}`, aiScore: 100 - i }));

describe("winner mix", () => {
  it("returns everything when the niche has no more than the slots", () => {
    expect(pickNicheMix(products(10), new Set(), "d", 50).map((p) => p._id)).toEqual(products(10).map((p) => p._id));
  });

  it("keeps the top, fills the rest with products not shown last round", () => {
    const all = products(100);
    const last = new Set(all.slice(25, 50).map((p) => p._id)); // last round's rotating half
    const mix = pickNicheMix(all, last, "2026-10-03:Pets", 50);
    expect(mix).toHaveLength(50);
    expect(mix.slice(0, 25).map((p) => p._id)).toEqual(all.slice(0, 25).map((p) => p._id));
    expect(mix.slice(25).every((p) => !last.has(p._id))).toBe(true);
    // Best score first.
    expect(mix.every((p, i) => i === 0 || mix[i - 1].aiScore >= p.aiScore)).toBe(true);
  });

  it("is the same for the same seed and differs between rounds", () => {
    const all = products(200);
    const a = pickNicheMix(all, new Set(), "2026-10-03:X", 50).map((p) => p._id);
    expect(pickNicheMix(all, new Set(), "2026-10-03:X", 50).map((p) => p._id)).toEqual(a);
    expect(pickNicheMix(all, new Set(), "2026-10-06:X", 50).map((p) => p._id)).not.toEqual(a);
  });

  it("random numbers stay in [0, 1)", () => {
    const r = seededRandom("x");
    for (let i = 0; i < 1000; i++) {
      const n = r();
      expect(n >= 0 && n < 1).toBe(true);
    }
  });

  it("counts days", () => {
    expect(daysBetween("2026-09-30", "2026-10-03")).toBe(3);
    expect(addDays("2026-09-30", 3)).toBe("2026-10-03");
  });
});
