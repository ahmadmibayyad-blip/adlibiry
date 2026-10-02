import { describe, expect, it } from "vitest";
import { monthlyRevenueRange, storeOrigin, summarizeCatalog } from "./storeSales";

const since = Date.parse("2026-10-01T10:00:00Z");

describe("storeOrigin", () => {
  it("normalises store links", () => {
    expect(storeOrigin("shop.example.com/collections/all")).toBe("https://shop.example.com");
    expect(storeOrigin("http://Shop.Example.com/")).toBe("https://shop.example.com");
    expect(storeOrigin("not a url")).toBeNull();
  });
});

describe("summarizeCatalog", () => {
  it("counts products changed since the last check as sales signals", () => {
    const s = summarizeCatalog(
      [
        // changed via a variant (stock), old product
        { title: "Cat Toy", handle: "cat-toy", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
          variants: [{ price: "20.00", updated_at: "2026-10-02T08:00:00Z" }, { price: "25.00" }], images: [{ src: "img1" }] },
        { title: "Dog Bed", handle: "dog-bed", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-02T09:00:00Z", variants: [{ price: "40" }] },
        // unchanged
        { title: "Old Lamp", handle: "lamp", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", variants: [{ price: "10" }] },
        // new product: counted as new, not as a sale
        { title: "New Mat", handle: "mat", created_at: "2026-10-02T07:00:00Z", updated_at: "2026-10-02T07:00:00Z", variants: [{ price: "15" }] },
      ],
      "https://shop.example.com",
      since,
    );
    expect(s).toMatchObject({ productCount: 4, updatedCount: 2, newCount: 1, avgPrice: 30, estOrdersLow: 2, estOrdersHigh: 6, estRevenueLow: 60, estRevenueHigh: 180 });
    expect(s.topProducts.map((p) => p.title)).toEqual(["Dog Bed", "Cat Toy"]);
    expect(s.topProducts[1]).toMatchObject({ url: "https://shop.example.com/products/cat-toy", imageUrl: "img1", price: 20 });
  });

  it("handles an empty or quiet catalog", () => {
    expect(summarizeCatalog([], "https://x.com", since)).toMatchObject({ productCount: 0, updatedCount: 0, avgPrice: 0, estRevenueHigh: 0 });
  });
});

describe("monthlyRevenueRange", () => {
  it("averages days and scales to a month", () => {
    expect(monthlyRevenueRange([{ estRevenueLow: 100, estRevenueHigh: 300 }, { estRevenueLow: 300, estRevenueHigh: 900 }])).toBe("$6K–$18K/mo");
    expect(monthlyRevenueRange([{ estRevenueLow: 10, estRevenueHigh: 20 }])).toBe("$300–$600/mo");
    expect(monthlyRevenueRange([])).toBeNull();
  });
});
