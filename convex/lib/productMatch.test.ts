import { describe, expect, it } from "vitest";
import {
  adSellsProduct, gmvFromText, isProductPage, parseCompact, productFlags, productTitleForAd, roundRobin, saturationFromCompetition, titleFromUrl, titleKey, urlKey,
} from "./productMatch";

describe("urlKey", () => {
  it("drops tracking, www and collection paths", () => {
    const a = urlKey("https://www.shop.com/collections/summer/products/Lawn-Sweeper?utm_source=fb&fbclid=1");
    const b = urlKey("https://shop.com/products/lawn-sweeper/");
    expect(a).toBe("shop.com/products/lawn-sweeper");
    expect(a).toBe(b);
  });
  it("keeps product id parameters and Amazon ASINs", () => {
    expect(urlKey("https://store.com/item.php?id=123&utm_source=x")).toBe("store.com/item.php?id=123");
    expect(urlKey("https://www.amazon.com/Some-Title/dp/B0ABCDEF12/ref=sr_1")).toBe("amazon.com/dp/b0abcdef12");
  });
  it("ignores home pages and bad URLs", () => {
    expect(urlKey("https://shop.com/")).toBeNull();
    expect(urlKey("not a url")).toBeNull();
  });
});

describe("product pages and titles", () => {
  it("recognises product pages", () => {
    expect(isProductPage("https://shop.com/products/lamp")).toBe(true);
    expect(isProductPage("https://www.tiktok.com/shop/pdp/1732279307420602493?source=anchor")).toBe(true);
    expect(isProductPage("https://shop.com/")).toBe(false);
    expect(isProductPage("https://shop.com/blogs/news/tips")).toBe(false);
    expect(isProductPage("https://apps.apple.com/app/id1")).toBe(false);
  });
  it("builds a title from the product slug", () => {
    expect(titleFromUrl("https://shop.com/products/vevor-21-inch-push-lawn-sweeper")).toBe("Vevor 21 Inch Push Lawn Sweeper");
    expect(titleFromUrl("https://shop.com/products/123456789")).toBeNull();
  });
  it("matches titles regardless of word order and filler", () => {
    expect(titleKey("Cooling Mat for Dogs – Free Shipping")).toBe(titleKey("dog cooling mat"));
    expect(titleKey("New!")).toBeNull();
  });
  it("picks the best product title for an ad", () => {
    const base = { headline: "Got a yard?", bodyText: "", source: "apify" };
    expect(productTitleForAd({ ...base, landingPageUrl: "https://s.com/products/leaf-grass-collector" })).toBe("Leaf Grass Collector");
    expect(
      productTitleForAd({ ...base, source: "nexscope", landingPageUrl: "https://www.tiktok.com/shop/pdp/1", bodyText: "Bamboo Cooling Mattress Topper · GMV $149K" }),
    ).toBe("Bamboo Cooling Mattress Topper");
    expect(productTitleForAd({ ...base, landingPageUrl: "https://s.com/p/1" })).toBe("Got a yard?");
  });
});

describe("flags", () => {
  it("spots big brands, personalised items and services", () => {
    expect(productFlags("Apple AirPods Pro case").isBigBrand).toBe(true);
    expect(productFlags("Personalized name necklace").isPersonalised).toBe(true);
    expect(productFlags("Custom pet portrait canvas").isPersonalised).toBe(true);
    expect(productFlags("$50 gift card").isService).toBe(true);
    expect(productFlags("Dog cooling mat")).toEqual({ isBigBrand: false, isPersonalised: false, isService: false });
  });
  it("only counts ads that sell one physical product", () => {
    const ad = { headline: "Keep your dog cool", bodyText: "", advertiserName: "Paws" };
    expect(adSellsProduct({ ...ad, landingPageUrl: "https://paws.com/products/cooling-mat" })).toBe(true);
    expect(adSellsProduct({ ...ad, landingPageUrl: "https://paws.com/" })).toBe(false);
    expect(adSellsProduct({ ...ad, headline: "Buy a gift card", landingPageUrl: "https://paws.com/products/gift-card" })).toBe(false);
  });
});

describe("numbers", () => {
  it("parses compact numbers and GMV in text", () => {
    expect(parseCompact("1.2M")).toBe(1_200_000);
    expect(parseCompact("18,947")).toBe(18947);
    expect(gmvFromText("Lawn sweeper · GMV $12.3K")).toBe(12300);
    expect(gmvFromText("no sales")).toBeUndefined();
  });
});

describe("roundRobin", () => {
  it("takes one from each list in turn", () => {
    expect(roundRobin([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
  });
});

describe("saturationFromCompetition", () => {
  it("maps the number of advertisers to a saturation band", () => {
    expect([0, 1, 2, 4, 5, 30].map(saturationFromCompetition)).toEqual(["Low", "Low", "Medium", "Medium", "High", "High"]);
  });
});
