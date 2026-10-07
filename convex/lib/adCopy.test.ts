import { describe, expect, it } from "vitest";
import { cleanAdCopy } from "./adCopy";
import { storeHost, titleSimilarity } from "./productMatch";
import { catalogDiff, reviewCountFromHtml, reviewsPerWeek, robotsAllows } from "./politeFetch";
import { calibrate, factorFor, storeRevenueEstimate } from "./revenueModel";
import { metaAdToExternal } from "./metaAdLibrary";
import { searchKeywords, signParams, topMatches } from "./aliexpress";

describe("ad copy hygiene", () => {
  it("strips page metadata and keeps the call to action separately", () => {
    expect(cleanAdCopy("Keep your dog cool all summer 🐶\nButton: Shop Now\nLink: paws.example.com")).toEqual({
      text: "Keep your dog cool all summer 🐶",
      cta: "Shop Now",
    });
    expect(cleanAdCopy("Sponsored\nLimited stock! Order today. Button: Learn More")).toEqual({ text: "Limited stock! Order today.", cta: "Learn More" });
    expect(cleanAdCopy("Great mat · Library ID: 123456 · Started running on: 1 Oct 2026 · CTA: Buy now")).toEqual({ text: "Great mat", cta: "Buy now" });
  });

  it("leaves normal copy alone", () => {
    const text = "Our best seller: the cooling mat. Link up with 10,000 happy dogs!";
    expect(cleanAdCopy(text)).toEqual({ text });
    expect(cleanAdCopy("")).toEqual({ text: "" });
  });
});

describe("same store, same product", () => {
  it("knows shops from marketplaces and compares titles word by word", () => {
    expect(storeHost("https://www.paws.example.com/products/x")).toBe("paws.example.com");
    expect(storeHost("https://www.amazon.com/dp/B0ABCDEF12")).toBeNull();
    expect(storeHost("not a url")).toBeNull();
    expect(titleSimilarity("Dog Cooling Mat for Large Dogs", "Large dog cooling mat")).toBe(1);
    expect(titleSimilarity("Dog Cooling Mat Blue", "Dog Cooling Mat Pink")).toBeLessThan(0.7);
  });
});

describe("robots.txt", () => {
  it("follows the most specific rule for our bot or everyone", () => {
    const txt = "User-agent: *\nDisallow: /admin\nDisallow: /products.json\nAllow: /products.json?limit=*\n\nUser-agent: OtherBot\nDisallow: /";
    expect(robotsAllows(txt, "/products.json")).toBe(false);
    expect(robotsAllows(txt, "/products.json?limit=250")).toBe(true);
    expect(robotsAllows(txt, "/products/mug")).toBe(true);
    expect(robotsAllows("User-agent: AdSpyProBot\nDisallow: /", "/products.json")).toBe(false);
    expect(robotsAllows("", "/products.json")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /*.json$", "/products.json")).toBe(false);
  });
});

describe("catalog changes and reviews", () => {
  it("counts added, removed and repriced products", () => {
    const diff = catalogDiff([{ h: "a", p: 10 }, { h: "b", p: 5 }], [{ h: "a", p: 12 }, { h: "c", p: 3 }]);
    expect(diff).toMatchObject({ added: 1, removed: 1, priceChanges: 1 });
    expect(catalogDiff(undefined, [{ h: "a", p: 1 }])).toBeUndefined();
  });

  it("reads review counts and turns them into reviews per week", () => {
    expect(reviewCountFromHtml('<script type="application/ld+json">{"aggregateRating":{"ratingValue":"4.8","reviewCount":"1312"}}</script>')).toBe(1312);
    expect(reviewCountFromHtml("<html>no reviews</html>")).toBeUndefined();
    expect(reviewsPerWeek([{ h: "a", p: 1, r: 100 }], [{ h: "a", p: 1, r: 130 }], 2)).toBe(15);
  });
});

describe("revenue model", () => {
  it("combines catalog changes and review velocity into one figure", () => {
    // $100/day from catalog changes ≈ $3K/mo; 10 reviews/week ÷ 2% × 4.33 × $15 ≈ $32K/mo: they disagree → Medium.
    expect(storeRevenueEstimate({ catalogDailyRevenue: 100, reviewsPerWeek: 10, avgPrice: 15 })).toMatchObject({ confidence: "Medium" });
    const agree = storeRevenueEstimate({ catalogDailyRevenue: 1000, reviewsPerWeek: 10, avgPrice: 15 })!;
    expect(agree.confidence).toBe("High");
    expect(agree.basis).toEqual(["catalog_changes", "review_velocity"]);
    expect(storeRevenueEstimate({})).toBeUndefined();
  });

  it("calibrates each method against known revenue once it has 5 examples", () => {
    const rows = [2, 2, 2.5, 1.5, 2].map((ratio, i) => ({ basis: "ad_funnel", truth: 1000 * ratio * (i + 1), estimate: 1000 * (i + 1) }));
    const cal = calibrate([...rows, { basis: "reported_gmv", truth: 500, estimate: 1000 }]);
    expect(cal.ad_funnel).toMatchObject({ n: 5, factor: 2 });
    expect(factorFor(cal, "ad_funnel")).toBe(2);
    expect(factorFor(cal, "reported_gmv")).toBe(1); // only one example yet
  });
});

describe("Meta Ad Library API rows", () => {
  it("maps an archive ad to our ad fields", () => {
    const now = Date.parse("2026-10-07T00:00:00Z");
    const ad = metaAdToExternal(
      { id: "123", page_name: "Paws & Co", ad_creative_bodies: ["Cool mat"], ad_creative_link_titles: ["Dog cooling mat"], ad_creative_link_captions: ["PAWS.EXAMPLE.COM"], ad_delivery_start_time: "2026-09-07", publisher_platforms: ["instagram"], eu_total_reach: 250_000 },
      "DK", "Pet Supplies", now,
    );
    expect(ad).toMatchObject({ externalId: "meta_123", source: "meta_ad_library", platform: "Instagram", daysRunning: 30, views: "250.0K", landingPageUrl: "https://paws.example.com", isActive: true });
  });
});

describe("AliExpress supplier cost", () => {
  it("signs requests and only accepts a close title match", async () => {
    const sig = await signParams({ b: "2", a: "1", sign: "x" }, "secret");
    expect(sig).toMatch(/^[0-9A-F]{64}$/);
    expect(sig).toBe(await signParams({ a: "1", b: "2" }, "secret"));
    expect(searchKeywords("Dog Cooling Mat — Large, Blue!")).toBe("Dog Cooling Mat Large Blue");
    const products = [
      { product_title: "Phone case", target_sale_price: "2" },
      { product_title: "Pet Dog Cooling Mat Summer Large", target_sale_price: "7.5", product_detail_url: "https://aliexpress.com/item/1.html" },
    ];
    expect(topMatches("Dog Cooling Mat Large", products)).toMatchObject([{ price: 7.5, url: "https://aliexpress.com/item/1.html" }]);
    expect(topMatches("Wireless earbuds", products)).toEqual([]);
  });
});

