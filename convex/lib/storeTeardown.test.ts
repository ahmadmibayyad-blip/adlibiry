import { describe, expect, it } from "vitest";
import {
  abundantVitalsOffers,
  allthemmaMetafieldHtml,
  axzeniaHtml,
  axzeniaProduct,
  hairfillerHtml,
  hairfillerProduct,
  healthypetzHtml,
  healthypetzProduct,
  helystaHtml,
  matrixProduct,
  matrixVitalsHtml,
  matrixVitalsOffers,
  ryyookDebutifyHtml,
  ryyookProduct,
  wanderHtml,
} from "./__fixtures__/storeTeardown";
import {
  debutifyBundle,
  productJsPath,
  productPrice,
  reviewSummary,
  sectionOrder,
  teardownProductPage,
  visibleText,
  vitalsBundle,
  vitalsOffersUrl,
} from "./storeTeardown";

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

  it("builds the Vitals offers URL from the app embed, only when a volume discount is set up", () => {
    expect(vitalsOffersUrl(matrixVitalsHtml, 7541618114778)).toBe(
      "https://appsolve.io/bundle/api/v2/sf/ub/pp/56358109371/en/1791838731/GB/7541618114778.json",
    );
    // Without the product .js, the embed's own product id.
    expect(vitalsOffersUrl(matrixVitalsHtml)).toBe(vitalsOffersUrl(matrixVitalsHtml, 7541618114778));
    // Offer type 2 is the volume discount; a store with only bundles (type 1) has nothing to fetch.
    expect(vitalsOffersUrl(matrixVitalsHtml.replace('"2":[1,2,6]', '"5":true'))).toBeUndefined();
    expect(vitalsOffersUrl(matrixVitalsHtml.replace(/window\.vtlsLiquidData\.ubOfferTypes=[^;]*;/, ""))).toBeUndefined();
    expect(vitalsOffersUrl(axzeniaHtml)).toBeUndefined();
  });

  it("reads a Vitals volume discount: ribbon, % tiers and our filled-in titles", () => {
    const t = teardownProductPage(matrixVitalsHtml, "/products/kong-sleep-aid", matrixProduct, "GBP", matrixVitalsOffers);
    expect(t.bundle?.app).toBe("Vitals");
    expect(t.bundle?.heading).toBe("Buy more, save more!");
    // Prices like "for £14.99" and "Save: £4.48" are Vitals' own maths in the browser, so those lines are left out.
    expect(t.bundle?.tiers).toEqual([
      { title: "Buy 1", quantity: 1, deal: { kind: "none" }, freeGifts: [], freeShipping: false, preselected: false },
      { title: "Buy 2 with 15% off", badge: "MOST POPULAR", quantity: 2, deal: { kind: "percent", value: 15 }, percentOff: 15, freeGifts: [], freeShipping: false, preselected: false },
      { title: "Buy 3 with 20% off", quantity: 3, deal: { kind: "percent", value: 20 }, percentOff: 20, freeGifts: [], freeShipping: false, preselected: false },
      { title: "Buy 4 with 30% off", quantity: 4, deal: { kind: "percent", value: 30 }, percentOff: 30, freeGifts: [], freeShipping: false, preselected: false },
    ]);
    // No offers fetched: no Vitals tiers.
    expect(teardownProductPage(matrixVitalsHtml, "/products/kong-sleep-aid", matrixProduct, "GBP").bundle).toBeUndefined();
    expect(vitalsBundle({ productBundle: null, volumeDiscount: null })).toBeUndefined();
  });

  it("reads Vitals' quantity ranges, the default tier and amount / fixed-price tiers", () => {
    const b = vitalsBundle(abundantVitalsOffers);
    expect(b?.tiers.map((x) => [x.title, x.quantity, x.deal, x.preselected])).toEqual([
      ["Buy 10 - 19", 10, { kind: "percent", value: 10 }, false],
      ["Buy 20 - 29", 20, { kind: "percent", value: 20 }, true],
      ["Buy 30+", 30, { kind: "percent", value: 30 }, false],
    ]);
    // "fixed" is an amount off each item, "fixed_price" the tier's total.
    const vd = { title: "", tiersWithGifts: [
      { discountType: "fixed", tierQuantity: "2", discountValue: "5" },
      { discountType: "fixed_price", tierQuantity: "3", discountValue: "50" },
    ], highlightTier: 2, highlightTierLabel: "BEST VALUE", preselectHighlightedTier: true };
    const [two, three] = vitalsBundle({ volumeDiscount: { vd } }, 20)!.tiers;
    expect(two).toMatchObject({ title: "Buy 2", deal: { kind: "amount", value: 10 }, percentOff: 25, preselected: false });
    expect(three).toMatchObject({ title: "Buy 3+", badge: "BEST VALUE", deal: { kind: "price", value: 50 }, percentOff: 16.7, preselected: true });
  });

  it("reads Debutify quantity breaks from the theme's widget settings", () => {
    const t = teardownProductPage(ryyookDebutifyHtml, "/products/streetwear-cap", ryyookProduct, "DKK");
    expect(t.bundle).toEqual({
      app: "Debutify",
      tiers: [
        // The single-unit option the theme adds and selects.
        { title: "Buy 1", quantity: 1, deal: { kind: "none" }, freeGifts: [], freeShipping: false, preselected: true },
        // "You have saved {SAVED_AMOUNT}" is filled in the browser, so it's left out.
        { title: "Buy 2", badge: "Most popular", quantity: 2, deal: { kind: "percent", value: 10 }, percentOff: 10, freeGifts: ["Cargo Pants"], freeShipping: false, preselected: false },
        { title: "Buy 3", quantity: 3, deal: { kind: "percent", value: 20 }, percentOff: 20, freeGifts: ["Baggy Jeans"], freeShipping: false, preselected: false },
      ],
    });
  });

  it("applies Debutify's rules for which products show the breaks", () => {
    const only = (rule: string) => ryyookDebutifyHtml.replace('"product_break_visibility":"all","product_break_collection":""', rule);
    const tiersFor = (html: string) => debutifyBundle(html, ryyookProduct)?.tiers.length ?? 0;
    expect(tiersFor(only('"product_break_visibility":"product","product_break_collection":""').replace('"product_break_product":""', '"product_break_product":"streetwear-cap"'))).toBe(3);
    expect(tiersFor(only('"product_break_visibility":"product","product_break_collection":""').replace('"product_break_product":""', '"product_break_product":"other-cap"'))).toBe(0);
    expect(tiersFor(only('"product_break_visibility":"collection","product_break_collection":"accessories"'))).toBe(3);
    expect(tiersFor(only('"product_break_visibility":"collection","product_break_collection":"shoes"'))).toBe(0);
    expect(tiersFor(only('"product_break_visibility":"tag","product_break_collection":""').replace('"product_break_tags":""', '"product_break_tags":"Streetwear, sale"'))).toBe(3);
    // A missing free product prints as an error object and isn't shown; a "10OFF" amount reads as 10, like the theme does.
    const noGift = ryyookDebutifyHtml.replace(/block_setting\.free_product = \{"id":8941240647703[^\n]*/, 'block_setting.free_product = {"error":"json not allowed for this object"};').replace('"product_break_discount_amount":"20"', '"product_break_discount_amount":"15OFF"');
    expect(debutifyBundle(noGift)?.tiers[2]).toMatchObject({ freeGifts: [], deal: { kind: "percent", value: 15 } });
    // The settings print on every page; without the widget on the product template there are no tiers.
    expect(debutifyBundle(ryyookDebutifyHtml.replace(/<dbtfy-product-quantity-break[\s\S]*<\/dbtfy-product-quantity-break>/, ""))).toBeUndefined();
    expect(debutifyBundle(ryyookDebutifyHtml.replace('"enable_quantity_breaks":true', '"enable_quantity_breaks":false'))).toBeUndefined();
    // Debutify's sticky bar without quantity breaks (hairfiller) keeps its Kaching tiers.
    expect(debutifyBundle(hairfillerHtml)).toBeUndefined();
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
