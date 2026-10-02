import { describe, expect, it } from "vitest";
import { fromShopify, fromTikTokShop, nicheFromTikTokCategory, normalizeShopify, storeFromShopify, trendFromGrowthPercent } from "./marketplaces";

describe("Nexscope marketplaces", () => {
  it("maps a TikTok Shop best-seller", () => {
    const d = fromTikTokShop({ productId: "1", title: "Magic cleaning sponge", price: 9.99, currency: "USD", totalSale1dCnt: 4000, totalSaleCnt: 400_000, growthRate: 80, imageUrl: "i", categoryName: "Home Supplies" });
    expect(d).toMatchObject({ externalId: "tts_1", price: 9.99, category: "Home & Living", trend: "Rising" });
    expect(d!.aiScore).toBeGreaterThan(80);
  });

  it("keeps a non-USD TikTok price as text and skips delisted or incomplete products", () => {
    expect(fromTikTokShop({ productId: "2", title: "x", price: 150, currency: "MXN", imageUrl: "i" })).toMatchObject({ price: undefined, originalPrice: "150 MXN" });
    expect(fromTikTokShop({ productId: "3", title: "x", imageUrl: "i", offShelvesText: "Yes" })).toBeNull();
    expect(fromTikTokShop({ productId: "4", title: "x" })).toBeNull();
  });

  it("maps a Shopify product with string numbers", () => {
    const d = fromShopify({ productId: "9", title: "Dog cooling mat", productLink: "https://s.example.com/p", previewImageUrl: "i", minPrice: "$34.95", facebookAdCount: "3", weekOrderCount: "120", weekRevenueGrowth: "-20" }, "Pet Supplies");
    expect(d).toMatchObject({ externalId: "shopify_9", price: 34.95, category: "Pet Supplies", trend: "Declining" });
    expect(fromShopify({ productId: "9", title: "x", productLink: "l", previewImageUrl: "i", isDeleted: "1" }, "Beauty")).toBeNull();
  });

  it("reads snake_case Shopify replies and builds the product link from domain + handle", () => {
    const p = normalizeShopify({ product_id: 7, title: "Gua sha set", store_domain: "glowshop.com", handle: "gua-sha", image_url: "i", min_price: "19.00", facebook_ad_count: 5 });
    expect(p).toMatchObject({ productId: "7", productLink: "https://glowshop.com/products/gua-sha", storeLink: "https://glowshop.com", facebookAdCount: "5" });
    const d = fromShopify(p, "Beauty")!;
    expect(d.price).toBe(19);
    expect(storeFromShopify(p, d)).toMatchObject({ externalId: "shopify:glowshop.com", activeAdsCount: 5 });
  });

  it("reads TikTok categories and growth", () => {
    expect(nicheFromTikTokCategory("Beauty & Personal Care")).toBe("Beauty");
    expect(nicheFromTikTokCategory("Womenswear & Underwear")).toBe("Fashion");
    expect(trendFromGrowthPercent(undefined)).toBe("Unknown");
    expect(trendFromGrowthPercent(0)).toBe("Stable");
  });
});
