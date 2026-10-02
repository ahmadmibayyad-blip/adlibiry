import { describe, expect, it } from "vitest";
import { estimateProduct, unitsPerMonthFromText } from "./estimates";

describe("product estimates", () => {
  it("uses reported views and spend as they are", () => {
    const e = estimateProduct({ views: 1_000_000, spend: 3000, price: 30 });
    expect(e.impressions).toEqual({ low: 1_000_000, high: 1_000_000 });
    expect(e.impressionsBasis).toBe("reported");
    expect(e.adSpend).toEqual({ low: 1000, high: 3000 });
    // half the views a month × 0.8–1.5% clicks × 1–3% conversion × $30
    expect(e.revenue).toEqual({ low: 1200, high: 6750 });
    expect(e.revenueBasis).toBe("ad_funnel");
  });

  it("estimates impressions from likes when there are no views", () => {
    const e = estimateProduct({ likes: 2000, comments: 100, price: 20 });
    expect(e.impressionsBasis).toBe("engagement");
    expect(e.impressions).toEqual({ low: 70_000, high: 210_000 });
    expect(e.adSpend).toEqual({ low: 420, high: 3150 });
  });

  it("prefers marketplace sales, then reported GMV, for revenue", () => {
    expect(estimateProduct({ unitsPerMonth: 100, price: 25, gmv: 999_999 })).toMatchObject({ revenue: { low: 1750, high: 3250 }, revenueBasis: "marketplace_sales" });
    expect(estimateProduct({ gmv: 90_000 })).toMatchObject({ revenue: { low: 30_000, high: 90_000 }, revenueBasis: "reported_gmv" });
  });

  it("leaves out what it can't estimate", () => {
    expect(estimateProduct({ price: 20 })).toEqual({});
  });

  it("reads orders from discovery descriptions", () => {
    expect(unitsPerMonthFromText("Shopify store product · 320 orders last week (est.) · 14 ads")).toBe(1376);
    expect(unitsPerMonthFromText("TikTok Shop best-seller · 1,200 sold in the latest day")).toBe(36_000);
    expect(unitsPerMonthFromText("nothing here")).toBeUndefined();
  });
});
