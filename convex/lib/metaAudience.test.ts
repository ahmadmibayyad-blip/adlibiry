import { describe, expect, it } from "vitest";
import { metaAdToExternal, metaAudience, META_FIELDS } from "./metaAdLibrary";
import { mergeAudience } from "./adFields";

const breakdown = [
  {
    country: "DE",
    age_gender_breakdowns: [
      { age_range: "25-34", male: 100, female: 300, unknown: 0 },
      { age_range: "18-24", male: 50, female: 50, unknown: 0 },
      { age_range: "Unknown", male: 0, female: 0, unknown: 20 },
    ],
  },
  { country: "UK", age_gender_breakdowns: [{ age_range: "65+", male: "40", female: "40" }] },
];

describe("Meta EU age × gender reach", () => {
  it("asks Meta for the breakdown", () => {
    expect(META_FIELDS.split(",")).toContain("age_country_gender_reach_breakdown");
  });

  it("turns the per-country breakdown into gender, age and country shares", () => {
    const a = metaAudience(breakdown, 1000)!;
    // 600 reached: 190 men, 390 women, 20 unknown.
    expect(a.totalReach).toBe(1000);
    expect(a.malePct).toBe(31.7);
    expect(a.femalePct).toBe(65);
    // Sorted youngest first; "Unknown" age left out; each bracket has its own split.
    expect(a.ages).toEqual([
      { bracket: "18-24", pct: 16.7, malePct: 50, femalePct: 50 },
      { bracket: "25-34", pct: 66.7, malePct: 25, femalePct: 75 },
      { bracket: "65+", pct: 13.3, malePct: 50, femalePct: 50 },
    ]);
    expect(a.countries).toEqual([
      { code: "DE", pct: 86.7 },
      { code: "GB", pct: 13.3 },
    ]);
  });

  it("is undefined without a usable breakdown", () => {
    expect(metaAudience(undefined)).toBeUndefined();
    expect(metaAudience([])).toBeUndefined();
    expect(metaAudience([{ country: "DE", age_gender_breakdowns: [{ age_range: "18-24", male: 0, female: 0 }] }])).toBeUndefined();
  });

  it("falls back to the breakdown's own total when Meta sends no EU reach", () => {
    expect(metaAudience(breakdown)!.totalReach).toBe(600);
  });

  it("is part of the mapped ad", () => {
    const ad = metaAdToExternal({ id: "1", eu_total_reach: 1000, age_country_gender_reach_breakdown: breakdown }, "DE", "Other", Date.now());
    expect(ad.audience?.ages).toHaveLength(3);
    expect(metaAdToExternal({ id: "2" }, "DE", "Other", Date.now()).audience).toBeUndefined();
  });
});

describe("mergeAudience", () => {
  const rich = { totalReach: 500, malePct: 40, femalePct: 60, ages: [{ bracket: "18-24", pct: 100 }], countries: [{ code: "DE", pct: 100 }] };
  const reachOnly = { totalReach: 900, ages: [], countries: [] };

  it("keeps a stored breakdown when a source only sends reach", () => {
    expect(mergeAudience(rich, reachOnly)).toEqual({ ...rich, totalReach: 900 });
  });

  it("takes a new breakdown, and reach-only data when nothing richer is stored", () => {
    const fresh = { ...rich, malePct: 10, femalePct: 90 };
    expect(mergeAudience(rich, fresh)).toEqual(fresh);
    expect(mergeAudience(undefined, reachOnly)).toEqual(reachOnly);
    expect(mergeAudience(rich, undefined)).toEqual(rich);
  });
});
