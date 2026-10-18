import { describe, expect, it } from "vitest";
import { inspectionSummary } from "./adStore";
import type { Inspection } from "./storeInspect";

const inspection = {
  shopify: true,
  theme: { name: "Dawn – Black Friday", schemaName: "Dawn" },
  apps: Array.from({ length: 10 }, (_, i) => ({ key: `app${i}`, name: `App ${i}`, category: "Reviews" })),
  pixels: [],
  teardown: {
    productPath: "/products/cool-mat",
    productTitle: "Cool Mat",
    reviews: { rating: 4.7, count: 1203, app: "Judge.me", source: "review widget" },
    price: { price: 29.95, compareAt: 59.9, percentOff: 50, currency: "EUR" },
    bundle: { app: "Kaching Bundles", tiers: [{ title: "1" }, { title: "2" }, { title: "3" }] },
    features: [],
    sections: [],
  },
  history: { months: 30, firstSeen: "2023-02-01", years: [] },
  domain: null,
} as unknown as Inspection;

describe("inspectionSummary", () => {
  it("keeps what the ad page shows", () => {
    const s = inspectionSummary(inspection, "2026-10-17T10:00:00.000Z")!;
    expect(s.theme).toBe("Dawn");
    expect(s.apps).toHaveLength(8);
    expect(s.appCount).toBe(10);
    expect(s.reviews).toEqual({ rating: 4.7, count: 1203, app: "Judge.me" });
    expect(s.price).toEqual({ price: 29.95, compareAt: 59.9, percentOff: 50, currency: "EUR" });
    expect(s.bundleTiers).toBe(3);
    expect(s.onlineSince).toBe("2023-02-01");
  });

  it("copes with a store whose product page couldn't be read", () => {
    const s = inspectionSummary({ shopify: false, apps: [], pixels: [], teardown: null }, "2026-10-17T10:00:00.000Z")!;
    expect(s).toEqual({ inspectedAt: "2026-10-17T10:00:00.000Z", shopify: false, apps: [], appCount: 0 });
    expect(inspectionSummary(undefined, "x")).toBeNull();
  });
});
