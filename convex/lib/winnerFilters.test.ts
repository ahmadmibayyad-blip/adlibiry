import { describe, expect, it } from "vitest";
import { filterAndSortWinners, marginOf, needsFiltering } from "./winnerFilters";

const item = (position: number, over: Record<string, unknown> = {}) => ({
  position,
  nicheRank: position,
  isNewToday: false,
  product: { title: `P${position}`, aiScore: 70, trend: "Stable", saturation: "Low", supplierUrl: "", publishedAt: "2026-10-01T00:00:00Z", ...over },
});

describe("winner filters", () => {
  it("knows when the plain index read is enough", () => {
    expect(needsFiltering({})).toBe(false);
    expect(needsFiltering({ sort: "rank", search: "" })).toBe(false);
    expect(needsFiltering({ sort: "score" })).toBe(true);
    expect(needsFiltering({ newToday: true })).toBe(true);
  });

  it("uses price and cost for margin, else the stored percent", () => {
    expect(marginOf({ ...item(1).product, price: 40, cost: 10 })).toBe(75);
    expect(marginOf({ ...item(1).product, marginPercent: 33 })).toBe(33);
    expect(marginOf(item(1).product)).toBeUndefined();
  });

  it("filters on every field and keeps feed order on ties", () => {
    const items = [
      item(1, { title: "LED dog collar", price: 15, adsCount: 12, source: "shopify" }),
      item(2, { title: "Cat bed", price: 35, linkedAds: 60, trend: "Rising", storeUrl: "https://x.example" }),
      { ...item(3, { title: "Dog bowl", price: 35 }), isNewToday: true },
    ];
    const titles = (f: Parameters<typeof filterAndSortWinners>[1]) => filterAndSortWinners(items, f).map((i) => i.product.title);
    expect(titles({ search: "DOG" })).toEqual(["LED dog collar", "Dog bowl"]);
    expect(titles({ source: "curated" })).toEqual(["Cat bed", "Dog bowl"]);
    expect(titles({ minAds: 50 })).toEqual(["Cat bed"]);
    expect(titles({ trend: "Rising" })).toEqual(["Cat bed"]);
    expect(titles({ hasStoreLink: true })).toEqual(["Cat bed"]);
    expect(titles({ newToday: true })).toEqual(["Dog bowl"]);
    expect(titles({ minPrice: 20, maxPrice: 40 })).toEqual(["Cat bed", "Dog bowl"]);
    expect(titles({ sort: "priceHigh" })).toEqual(["Cat bed", "Dog bowl", "LED dog collar"]);
    // Products without the number sort last.
    expect(titles({ sort: "ads" })).toEqual(["Cat bed", "LED dog collar", "Dog bowl"]);
  });
});
