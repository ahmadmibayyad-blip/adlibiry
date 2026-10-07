import { describe, expect, it } from "vitest";
import { countAngles, verdict } from "./verdict";
import { northStar } from "./northStar";

const strong = {
  estRevenue: { low: 20_000, high: 40_000 },
  estBasis: { revenue: "marketplace_sales" },
  momentum14: 12,
  saturationByCountry: [{ country: "DE", advertisers: 3, level: "Medium" }],
  price: 40,
  cost: 18,
  angleCount: 4,
  targetCountry: "DE",
};

describe("Should I test this?", () => {
  it("says test when demand, room and margin all check out", () => {
    const v = verdict(strong);
    expect(v.call).toBe("test");
    expect(v.checks.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(v.line).toBe("Strong test candidate — medium saturation in DE, ~55% margin, rising demand.");
  });

  it("says skip when the user's market is crowded or demand falls", () => {
    const crowded = verdict({ ...strong, saturationByCountry: [{ country: "DE", advertisers: 9, level: "High" }] });
    expect(crowded.call).toBe("skip");
    expect(crowded.line).toMatch(/^Skip for now — crowded in DE/);
    expect(verdict({ ...strong, momentum14: -8 }).line).toMatch(/demand is falling/);
  });

  it("says take a closer look when key data is missing, never guessing it", () => {
    const v = verdict({ ...strong, cost: undefined, angleCount: 0 });
    expect(v.call).toBe("test"); // margin unknown doesn't block a test
    const unknownDemand = verdict({ ...strong, estRevenue: undefined });
    expect(unknownDemand.call).toBe("maybe");
    expect(unknownDemand.line).toMatch(/demand still unknown/);
    expect(unknownDemand.checks[0]).toMatchObject({ ok: null, detail: "No sales estimate yet" });
  });

  it("uses overall competition when there's no data for the user's country", () => {
    const v = verdict({ ...strong, saturationByCountry: [], saturation: "Low", targetCountry: "DK" });
    expect(v.checks[1]).toMatchObject({ ok: true, detail: "Low competition overall, none seen in DK yet" });
  });

  it("counts distinct hooks", () => {
    expect(countAngles(["Keep your dog cool!", "keep your dog cool", "Summer is here", "Vet approved", "ok"])).toBe(3);
  });
});

describe("north star", () => {
  it("counts a validated test when the same user viewed the verdict and saved the product", () => {
    const r = northStar([
      { userId: "u1", type: "verdict_view", productId: "p1" },
      { userId: "u1", type: "product_save", productId: "p1" },
      { userId: "u1", type: "product_save", productId: "p2" }, // saved without the verdict
      { userId: "u2", type: "product_open", productId: "p1" },
    ]);
    expect(r).toMatchObject({ activeUsers: 2, validatedTests: 1, perActiveUser: 0.5 });
    expect(r.funnel).toEqual({ product_open: 1, verdict_view: 1, product_save: 2, supplier_click: 0 });
  });
});
