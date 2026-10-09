import { describe, expect, it } from "vitest";
import { cleanReport, marginMath, researchEvidence, reviewSample, type ResearchEvidence } from "./researchReport";

describe("AI research verdict", () => {
  it("does the margin maths itself, and only with both numbers", () => {
    expect(marginMath(29.99, 8.5)).toEqual({ price: 29.99, cost: 8.5, fees: 1.17, profit: 20.32, profitPct: 68, breakEvenAdCost: 20.32 });
    expect(marginMath(5, 6)?.breakEvenAdCost).toBe(0);
    expect(marginMath(29.99, undefined)).toBeNull();
    expect(marginMath(undefined, 4)).toBeNull();
  });

  it("samples what supplier buyers praise and complain about", () => {
    const s = reviewSample({ data: { productEvaluationStatistic: { evarageStar: 4.66, totalNum: 15, fiveStarNum: 13, threeStarNum: 2 }, evaViewList: [
      { buyerEval: 100, buyerTranslationFeedback: "Good cat brushes, spray a little water first" },
      { buyerEval: 100, buyerTranslationFeedback: "" },
      { buyerEval: 60, buyerTranslationFeedback: "Its very poor quality" },
      { buyerEval: 60, buyerTranslationFeedback: "It works but not very well." },
    ] } });
    expect(s).toEqual({
      average: 4.7, total: 15, stars: [13, 0, 2, 0, 0],
      praise: ["Good cat brushes, spray a little water first"], complaints: ["Its very poor quality", "It works but not very well."],
    });
    expect(reviewSample({ data: { productEvaluationStatistic: { totalNum: 0 } } })).toBeNull();
  });

  it("separates AdSpy data from ad claims, and says what's unknown", () => {
    const e: ResearchEvidence = {
      title: "Self-cleaning pet brush", category: "Pet Supplies", description: "", targetCountry: "DK",
      retailPrice: 24.99, cost: 4.09, costSource: "aliexpress", margin: marginMath(24.99, 4.09),
      ads: { count: 12, advertisers: 4, longestDays: 46, platforms: ["Facebook"], countries: ["DK", "SE"], samples: ["Vets hate this brush! 50,000 sold"] },
      quickCheck: "Worth a closer look — demand still unknown.",
    };
    const text = researchEvidence(e);
    expect(text.indexOf("FROM ADSPY DATA")).toBeLessThan(text.indexOf("12 ads by 4 advertisers"));
    expect(text.indexOf("NOT EVIDENCE")).toBeLessThan(text.indexOf("50,000 sold"));
    expect(text.indexOf("12 ads")).toBeLessThan(text.indexOf("NOT EVIDENCE"));
    expect(text).toContain("break-even ad cost per sale");
    expect(text).toContain("No sales estimate.");
    expect(text).toContain("No supplier reviews read.");
    expect(researchEvidence({ ...e, cost: undefined, margin: null })).toContain("Don't guess it.");
  });

  it("turns whatever the AI returns into a valid report", () => {
    const r = cleanReport({
      call: "Research more", bottomLine: "Thin evidence.", nextTask: "Supplier vetting", nextTaskWhy: "Quality complaints.",
      reasons: [{ text: "12 ads by 4 advertisers", label: "adspy" }, { text: "Likely gift buyers", label: "assumption" }, { text: "Real delivery time", label: "needs verification" }, { text: "" }],
      risks: [{ text: "Two 3★ quality complaints", blocker: false }], fixes: ["Bundle of 2"], missing: ["Delivery time to DK"], checklist: Array.from({ length: 9 }, (_, i) => `Check ${i}`),
    });
    expect(r).toMatchObject({ call: "research", nextTask: "supplier vetting", reasons: [{ label: "adspy" }, { label: "assumption" }, { label: "verify" }] });
    expect(r.checklist).toHaveLength(7);
    expect(cleanReport({ call: "TEST", nextTask: "go viral" })).toMatchObject({ call: "test", nextTask: "no specialist task yet", reasons: [] });
    expect(cleanReport(null).call).toBe("research");
  });
});
