import { describe, expect, it } from "vitest";
import { CALC_DEFAULTS, allGuides, glossary, matches, nextGuide, topics, unitEconomics } from "./knowledge";

describe("Knowledge", () => {
  it("has the 12 topics and 33 guides, with unique guide ids", () => {
    expect(topics).toHaveLength(12);
    expect(allGuides).toHaveLength(33);
    expect(new Set(allGuides.map((g) => g.id)).size).toBe(33);
  });

  it("calculator defaults reproduce the Unit economics guide's example", () => {
    const r = unitEconomics(CALC_DEFAULTS);
    expect(r.net.toFixed(2)).toBe("31.96");
    expect(r.breakEvenCpa.toFixed(2)).toBe("14.02");
    expect(r.breakEvenRoas?.toFixed(2)).toBe("2.85");
    expect(r.targetRoas?.toFixed(2)).toBe("3.70");
    expect(unitEconomics({ ...CALC_DEFAULTS, cost: 30 })).toMatchObject({ breakEvenRoas: null, targetRoas: null });
  });

  it("searches titles, summaries, steps and tips", () => {
    const g = allGuides.find((x) => x.id === "unit-economics")!;
    expect(matches(g, "break-even")).toBe(true);
    expect(matches(g, "denmark vat")).toBe(true); // a step
    expect(matches(g, "paste notes")).toBe(true); // the tip
    expect(matches(g, "tiktok")).toBe(false);
    expect(matches(g, "  ")).toBe(true);
  });

  it("goes to the next guide, across topics, and stops after the last", () => {
    expect(nextGuide("pricing", "unit-economics")?.guide.id).toBe("aov");
    expect(nextGuide("pricing", "aov")?.topic.id).toBe("meta");
    const last = allGuides[allGuides.length - 1];
    expect(nextGuide(last.topic.id, last.id)).toBeNull();
  });

  it("sorts the glossary alphabetically", () => {
    const terms = glossary.map((t) => t[0]);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(terms[0]).toBe("Agent");
  });
});
