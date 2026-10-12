import { describe, expect, it } from "vitest";
import {
  allthemmaMetafieldHtml,
  axzeniaHtml,
  axzeniaProduct,
  hairfillerHtml,
  hairfillerProduct,
  healthypetzHtml,
  healthypetzProduct,
  helystaHtml,
  wanderHtml,
} from "./__fixtures__/storeTeardown";
import { productJsPath, productPrice, reviewSummary, sectionOrder, teardownProductPage, visibleText } from "./storeTeardown";

const keys = (t: { features: { key: string }[] }) => t.features.map((f) => f.key);

describe("store teardown", () => {
  it("reads Kaching % tiers, the Loox rating, price vs compare-at and the section order", () => {
    const t = teardownProductPage(axzeniaHtml, "/products/instant-posture-corrector", axzeniaProduct, "USD");
    expect(t.productTitle).toBe("Smart-Webbing Brace");
    expect(t.price).toEqual({ price: 74.99, compareAt: 125, percentOff: 40, currency: "USD", variants: 2 });
    expect(t.reviews).toEqual({ app: "Loox", rating: 4.5, count: 691, source: "review widget" });
    expect(t.bundle?.app).toBe("Kaching Bundles");
    expect(t.bundle?.heading).toBe("Select Quantity");
    expect(t.bundle?.tiers).toEqual([
      { title: "1 Brace", quantity: 1, deal: { kind: "none" }, freeGifts: [], freeShipping: false, preselected: false },
      {
        title: "2 Braces", subtitle: "Free Shipping", label: "$67.50/Bra", badge: "Most Popular", quantity: 2,
        deal: { kind: "percent", value: 10 }, percentOff: 10, freeGifts: [], freeShipping: true, preselected: true,
      },
      {
        title: "3 Braces", subtitle: "Free Shipping", label: "$60.00/Bra", badge: "Best Value", quantity: 3,
        deal: { kind: "percent", value: 20 }, percentOff: 20, freeGifts: [], freeShipping: true, preselected: false,
      },
    ]);
    expect(t.sections.map((s) => s.label)).toEqual([
      "Buy box", "Slideshow / gallery", "Text", "Video", "Image with text", "Image with text", "Testimonials", "Reviews (app)",
    ]);
    // The footer isn't part of the product template.
    expect(t.sections.some((s) => s.id.includes("footer"))).toBe(false);
    expect(keys(t)).toEqual(expect.arrayContaining(["free_shipping", "video", "check_bullets"]));
    expect(keys(t)).not.toContain("sticky_atc"); // Kaching's sticky bar is turned off here
  });

  it("reads Buy X get Y tiers and fills Kaching's {{saved_percentage}} with our own arithmetic", () => {
    const t = teardownProductPage(healthypetzHtml, "/products/liquidcollagen", healthypetzProduct, "USD");
    const [one, two, three] = t.bundle!.tiers;
    // A placeholder we can't fill is left out, not shown half-written.
    expect(one).toMatchObject({ title: "Buy 1 Bottle", quantity: 1, deal: { kind: "price", value: 37 } });
    expect(one.subtitle).toBeUndefined();
    // 74.99 for 3 bottles vs. 3 × 37: 32% off by our math.
    expect(two).toMatchObject({ title: "Buy 2, Get 1 FREE", subtitle: "You Save 32%", badge: "Most Popular", quantity: 3, deal: { kind: "buyXgetY", buy: 2, get: 1 }, percentOff: 32.4, preselected: true });
    // The page's own claim stays as written next to our number.
    expect(three).toMatchObject({ subtitle: "You Save 70%", badge: "Free Shipping", quantity: 5, percentOff: 39.5, freeShipping: true });
    expect(keys(t)).toEqual(expect.arrayContaining(["countdown", "low_stock", "guarantee", "faq", "customer_claim"]));
    expect(t.features.find((f) => f.key === "low_stock")?.evidence).toContain("89% sold");
    expect(t.price).toEqual({ price: 39, currency: "USD", variants: 1 });
  });

  it("reads fixed-price tiers with free shipping and a free gift, and the Judge.me badge", () => {
    const t = teardownProductPage(hairfillerHtml, "/products/hairfiller-instant-dye-shampoo", hairfillerProduct, "NOK");
    expect(t.reviews).toEqual({ app: "Judge.me", rating: 4.92, count: 327, source: "review widget" });
    expect(t.bundle?.tiers.map((x) => [x.title, x.label, x.deal, x.percentOff, x.freeShipping, x.freeGifts])).toEqual([
      ["1 Instant Dye Shampoo", "349 kr/stk", { kind: "none" }, undefined, false, []],
      ["2 Instant Dye Shampoo", "299 kr/stk", { kind: "price", value: 599 }, 14.2, true, []],
      ["3 Instant Dye Shampoo", "233 kr/stk", { kind: "price", value: 699 }, 33.2, true, ["Gratis hodebunnsmassasje-børste (verdi 149kr)🎁"]],
    ]);
    expect(t.sections.map((s) => s.label)).toEqual(["Buy box", "FAQ / accordion", "Reviews (app)"]);
    expect(keys(t)).toEqual(expect.arrayContaining(["sticky_atc", "ends_today", "guarantee", "pay_later", "faq"]));
  });

  it("reads Upsell Koala tiers from the page markup", () => {
    const t = teardownProductPage(helystaHtml, "/products/orthoseat", undefined, "DKK");
    expect(t.bundle?.app).toBe("Upsell Koala");
    expect(t.bundle?.tiers.map((x) => [x.title, x.subtitle, x.badge, x.quantity, x.preselected])).toEqual([
      ["1 STK", "36% Rabat", undefined, 1, true],
      ["2 STK", "Kun 300 kr/stk", "Mest populære", 2, false],
      ["3 STK", "Kun 250 kr/stk", "Bedste tilbud", 3, false],
    ]);
    expect(t.price).toBeUndefined(); // no product .js
    expect(keys(t)).toEqual(expect.arrayContaining(["live_viewers", "free_shipping", "sticky_atc"]));
  });

  it("finds ratings in Okendo, structured data and the review metafields", () => {
    expect(reviewSummary(wanderHtml)).toEqual({ app: "Okendo", rating: 4.6, count: 1263, source: "review widget" });
    expect(reviewSummary('<script type="application/ld+json">{"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.85","reviewCount":"5078"}}</script>')).toEqual({
      rating: 4.85, count: 5078, source: "structured data",
    });
    expect(reviewSummary(allthemmaMetafieldHtml)).toEqual({ rating: 4.77, count: 66, source: "review metafield" });
    expect(reviewSummary("<p>No reviews yet</p>")).toBeUndefined();
    // A rating of 0 from an empty widget isn't a rating.
    expect(reviewSummary(`<div class='jdgm-prev-badge' data-average-rating='0.00' data-number-of-reviews='0'></div>`)).toBeUndefined();
  });

  it("works out price, the product .js path and page text", () => {
    expect(productPrice({ price: 54999, compare_at_price: 54999, variants: [] })).toEqual({ price: 549.99 }); // same as compare-at: no sale
    expect(productPrice({ variants: [{ price: 2000, compare_at_price: 4000, available: false }, { price: 2500, compare_at_price: 5000, available: true }] })).toMatchObject({
      price: 25, compareAt: 50, percentOff: 50,
    });
    expect(productPrice("not json")).toBeUndefined();
    expect(productJsPath("/da-dk/collections/all/products/petstar")).toBe("/da-dk/products/petstar.js");
    expect(productJsPath("/products/orthoseat%E2%84%A2-pude")).toBe("/products/orthoseat%E2%84%A2-pude.js");
    expect(productJsPath("/pages/about")).toBeUndefined();
    expect(visibleText("<style>.a{}</style><p>Fri&nbsp;fragt &amp; 30 dages</p><script>var x='hidden'</script>")).toBe("Fri fragt & 30 dages");
    expect(sectionOrder("<div id=\"shopify-section-sections--1__header\"></div>")).toEqual([]);
  });
});
