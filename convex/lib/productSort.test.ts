import { describe, expect, it } from "vitest";
import { sortProducts, sortsSearch } from "./productSort";

describe("sortProducts", () => {
  const items = [
    { id: "a", aiScore: 26, price: 48 },
    { id: "b", aiScore: 98, price: 40 },
    { id: "c", price: 12 },
    { id: "d", aiScore: 57, price: 0 },
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("orders by AdSpy score, missing scores last", () => {
    expect(ids(sortProducts(items, "score"))).toEqual(["b", "d", "a", "c"]);
  });
  it("orders low prices first and leaves products without a price last", () => {
    expect(ids(sortProducts(items, "priceLow"))).toEqual(["c", "b", "a", "d"]);
  });
  it("keeps relevance for newest and unknown sorts", () => {
    expect(sortsSearch("newest")).toBe(false);
    expect(sortsSearch(undefined)).toBe(false);
    expect(sortsSearch("margin")).toBe(true);
    expect(ids(sortProducts(items, "newest"))).toEqual(["a", "b", "c", "d"]);
  });
});
