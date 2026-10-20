import { describe, expect, it } from "vitest";
import { simpleVerdict } from "./simpleVerdict.ts";

const money = (usd: number) => `$${usd}`;

describe("simpleVerdict", () => {
  it("calls a strong, quiet product good to test and says why", () => {
    const v = simpleVerdict({ aiScore: 82, saturation: "Low", trend: "Rising", price: 30, cost: 8, linkedAds: 14 }, money);
    expect(v.label).toBe("Good to test");
    expect(v.reasons.map((r) => r.text)).toEqual([
      "Shops are running 14 ads for it.",
      "It sells for $30. You can buy it for about $8.",
      "More people are looking for it lately.",
    ]);
  });

  it("keeps warnings in the three lines and doesn't call a crowded product good", () => {
    const v = simpleVerdict({ aiScore: 80, saturation: "High", trend: "Declining", linkedAds: 3 }, money);
    expect(v.label).toBe("Worth a look");
    expect(v.reasons.filter((r) => !r.ok)).toHaveLength(2);
    expect(v.reasons).toHaveLength(3);
  });

  it("says 'products like it' for estimated prices and leaves out unknown facts", () => {
    const v = simpleVerdict({ aiScore: 40, saturation: "Unknown", trend: "Stable", price: 20, cost: 5, priceSource: "estimated_market" }, money);
    expect(v.label).toBe("Think twice");
    expect(v.good).toBe(false);
    expect(v.reasons.map((r) => r.text)).toEqual(["Products like it sell for about $20 and cost about $5."]);
  });
});
