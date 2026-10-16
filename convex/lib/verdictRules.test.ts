import { describe, expect, it } from "vitest";
import { marginMath } from "./researchReport";
import { evaluateRules, finalCall, whyLine, RULES_VERSION, type RuleInput } from "./verdictRules";

const base = (over: Partial<RuleInput> = {}): RuleInput => ({
  margin: marginMath(30, 8),
  priceAssumed: false,
  vatRate: null,
  ads: { advertisers: 2, longestDays: 30 },
  supplierOrders: 1000,
  adspyDemandOk: null,
  brandText: "Cat brush",
  ...over,
});

const seen = (r: ReturnType<typeof evaluateRules>, key: string) => r.signals.find((s) => s.key === key)?.seen;

describe("verdictRules", () => {
  it("has a version", () => expect(RULES_VERSION).toBe(2));

  it("signal thresholds", () => {
    const r = evaluateRules(base());
    expect(seen(r, "ads")).toBe(true);
    expect(seen(r, "supplier")).toBe(true);
    expect(r.ceiling).toBe("test");

    const low = evaluateRules(base({ ads: { advertisers: 2, longestDays: 29 } }));
    expect(seen(low, "ads")).toBe(false);
    expect(low.ceiling).toBe("research");
    expect(low.cappedBy).toContain("1 of 5 demand signals");

    expect(seen(evaluateRules(base({ ads: { advertisers: 1, longestDays: 60 } })), "ads")).toBe(false);
    expect(seen(evaluateRules(base({ supplierOrders: 999 })), "supplier")).toBe(false);
    expect(seen(evaluateRules(base({ tiktokUnits: 1000 })), "tiktok")).toBe(true);
    expect(seen(evaluateRules(base({ tiktokUnits: 999 })), "tiktok")).toBe(false);
    expect(seen(evaluateRules(base({ ownOrders: 3 })), "ownStore")).toBe(true);
    expect(seen(evaluateRules(base({ ownOrders: 2 })), "ownStore")).toBe(false);
    expect(seen(evaluateRules(base({ adspyDemandOk: true })), "adspy")).toBe(true);
    expect(seen(evaluateRules(base({ adspyDemandOk: false })), "adspy")).toBe(false);
  });

  it("margin blocker on a seen price", () => {
    const m = marginMath(12, 2.5);
    expect(evaluateRules(base({ margin: m })).blockers).toEqual([]);
    const r = evaluateRules(base({ margin: m, vatRate: 0.25 }));
    expect(r.blockers).toContain("Break-even ad cost under $8 after VAT");
    expect(r.ceiling).toBe("skip");
    expect(r.afterVat).toBe(true);
    expect(r.breakEven).toBeCloseTo(6.45, 2);
  });

  it("assumed price never skips", () => {
    const r = evaluateRules(base({ margin: marginMath(12, 2.5), vatRate: 0.25, priceAssumed: true }));
    expect(r.blockers).toEqual([]);
    expect(r.ceiling).toBe("research");
    expect(r.cappedBy).toBe("price is a category estimate");
  });

  it("unknown cost", () => {
    const r = evaluateRules(base({ margin: null }));
    expect(r.ceiling).toBe("research");
    expect(r.cappedBy).toBe("supplier cost unknown");
    expect(r.costKnown).toBe(false);
  });

  it("brand", () => {
    const r = evaluateRules(base({ brandText: "Stanley Quencher tumbler" }));
    expect(r.blockers.some((b) => b.includes("Stanley"))).toBe(true);
    expect(r.ceiling).toBe("skip");
  });

  it("shipping", () => {
    expect(evaluateRules(base({ shippingDays: 16 })).ceiling).toBe("skip");
    expect(evaluateRules(base({ shippingDays: 16 })).blockers).toContain("Shipping over 15 days");
    expect(evaluateRules(base({ shippingDays: 15 })).blockers).toEqual([]);
    expect(evaluateRules(base()).blockers).toEqual([]);
  });

  it("finalCall", () => {
    const research = evaluateRules(base({ ads: { advertisers: 1, longestDays: 1 } }));
    const test = evaluateRules(base());
    const a = finalCall("test", false, research);
    expect(a.call).toBe("research");
    expect(a.cappedBy).toBeTruthy();
    expect(finalCall("skip", false, test)).toEqual({ call: "skip", cappedBy: undefined });
    expect(finalCall("test", true, test).call).toBe("skip");
    expect(finalCall("research", false, test)).toEqual({ call: "research", cappedBy: undefined });
  });

  it("whyLine", () => {
    const money = (n: number) => "$" + n.toFixed(0);
    expect(whyLine(evaluateRules(base()), money)).toBe("2 of 5 demand signals · cost known · break-even $21");
    expect(whyLine(evaluateRules(base({ vatRate: 0.25 })), money)).toMatch(/after VAT$/);
    expect(whyLine(evaluateRules(base({ margin: null })), money)).toBe("2 of 5 demand signals · cost unknown");
  });
});
