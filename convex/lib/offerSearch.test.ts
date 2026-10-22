import { describe, expect, it } from "vitest";
import {
  adLink,
  adLibrarySearchUrl,
  adShowsOffer,
  dailyOfferPhrases,
  dropshipScore,
  filterStores,
  groupByStore,
  OFFER_COUNTRIES,
  OFFER_IDS,
  OFFERS,
  productHandle,
  readShopifyProduct,
  readShopMeta,
  researchAdsPerCountry,
  researchUrls,
  searchKey,
  searchPhrases,
  shortError,
  storeHost,
  toSearchAd,
  type FoundStore,
} from "./offerSearch";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-12T12:00:00Z");

describe("Offer Search", () => {
  it("searches the offer in the country's language, with the user's extra words", () => {
    // Up to three short forms dropshippers actually write, searched as exact phrases.
    expect(searchPhrases({ offer: "bxgy", country: "nl" })).toEqual(["2+1 gratis", "1+1 gratis", "3 halen 2 betalen"]);
    expect(searchPhrases({ offer: "bxgy", country: "dk" })).toEqual(["1+1 gratis", "2+1 gratis", "køb 2 få 1 gratis"]);
    expect(searchPhrases({ offer: "free_shipping", country: "DE", extra: " hund " })).toEqual(["kostenloser Versand hund", "gratis Versand hund", "versandkostenfrei hund"]);
    expect(searchPhrases({ offer: "percent", country: "US" })).toEqual(["50% off", "40% off", "60% off"]);
    // A country we don't list falls back to English; the user's own phrase wins.
    expect(searchPhrases({ offer: "free_gift", country: "PL" })).toEqual(["free gift"]);
    expect(searchPhrases({ offer: "bxgy", country: "SE", custom: "  3 för 2  ", extra: "katt" })).toEqual(["3 för 2 katt"]);
    // Every offer has phrases in every language our countries use.
    for (const id of OFFER_IDS) for (const c of Object.values(OFFER_COUNTRIES)) expect(OFFERS[id].phrases[c.lang].length, `${id} ${c.lang}`).toBeGreaterThan(0);
  });

  it("gives the daily import one phrase per offer in the country's language", () => {
    expect(dailyOfferPhrases("se")).toEqual([
      { offer: "bxgy", phrase: "1+1 gratis" },
      { offer: "percent", phrase: "50% rabatt" },
      { offer: "free_shipping", phrase: "fri frakt" },
      { offer: "free_gift", phrase: "gratis present" },
      { offer: "multibuy", phrase: "köp fler spara mer" },
    ]);
  });

  it("caches by country and phrases, whatever their order or case", () => {
    expect(searchKey("dk", ["Køb 2", "gratis fragt"])).toBe(searchKey("DK", ["gratis fragt", "køb 2"]));
    expect(searchKey("DK", ["køb 2"])).not.toBe(searchKey("SE", ["køb 2"]));
    // Exact phrase, so "2+1 gratis" doesn't match every ad that just says "gratis".
    expect(adLibrarySearchUrl("dk", "køb 2 få 1")).toContain("country=DK&q=%22k%C3%B8b+2+f%C3%A5+1%22");
    expect(adLibrarySearchUrl("dk", "køb 2 få 1")).toContain("search_type=keyword_exact_phrase");
  });

  it("reads the Ad Library scraper's rows, and skips error rows", () => {
    const ad = toSearchAd({
      ad_archive_id: "123",
      page_id: "999",
      page_name: "PawTech",
      start_date: (NOW - 40 * DAY) / 1000,
      collation_count: 4,
      snapshot: {
        title: "{{product.name}}",
        body: { text: "Køb 2 få 1 GRATIS i dag 🐾" },
        link_url: "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.pawtech.dk%2Fproducts%2Fbilsaede%3Ffbclid%3Dabc",
        cards: [{ title: "Hundesæde til bilen", original_image_url: "https://img/1.jpg" }],
      },
    });
    expect(ad).toEqual({
      id: "123", pageId: "999", pageName: "PawTech", link: "https://www.pawtech.dk/products/bilsaede",
      headline: "Hundesæde til bilen", body: "Køb 2 få 1 GRATIS i dag 🐾", image: "https://img/1.jpg", startMs: NOW - 40 * DAY, copies: 4,
    });
    expect(toSearchAd({ error: "Maximum charged results option must be atleast 10" })).toBeNull();
    expect(adLink("not a url")).toBe("");
  });

  it("groups the ads by store, busiest first, with their offers", () => {
    const ad = (id: string, link: string, body: string, daysAgo: number, copies = 1) => ({ id, pageName: "Adv " + link.split("/")[2], link, headline: "", body, startMs: NOW - daysAgo * DAY, copies });
    const stores = groupByStore(
      [
        ad("1", "https://www.pawtech.dk/products/seat", "Køb 2 få 1 gratis", 40, 3),
        ad("2", "https://pawtech.dk/products/seat", "Gratis fragt i dag", 12),
        ad("2", "https://pawtech.dk/products/seat", "duplicate row", 12),
        ad("3", "https://helysta.dk/products/pude", "50% rabat – kun i dag", 90),
        ad("4", "https://www.facebook.com/somepage", "Køb 2 få 1 gratis", 5),
        ad("5", "", "no link", 5),
      ],
      NOW,
    );
    expect(stores.map((s) => s.host)).toEqual(["pawtech.dk", "helysta.dk"]);
    expect(stores[0]).toMatchObject({ ads: 2, copies: 4, oldestDays: 40, productPaths: ["/products/seat"], advertisers: ["Adv www.pawtech.dk", "Adv pawtech.dk"] });
    expect(stores[0].offers.map((o) => o.label)).toEqual(expect.arrayContaining(["Buy 2 get 1", "Free shipping"]));
    expect(stores[1]).toMatchObject({ ads: 1, oldestDays: 90 });
    expect(stores[1].sample[0].offers).toContain("50% off");
    expect(storeHost("https://instagram.com/x")).toBeNull();
  });
});

describe("Offer Search store details", () => {
  it("reads the EU reach from the ad details, and adds it up per store with its most linked products first", () => {
    expect(toSearchAd({ ad_archive_id: "9", snapshot: {}, aaa_info: { eu_total_reach: 12_500 } })).toMatchObject({ reach: 12_500 });
    expect(toSearchAd({ ad_archive_id: "9", snapshot: {} })).not.toHaveProperty("reach");
    const ad = (id: string, link: string, reach?: number) => ({ id, pageName: "Paw", link, headline: "", body: "", startMs: NOW - DAY, copies: 1, ...(reach ? { reach } : {}) });
    const [store] = groupByStore(
      [
        ad("1", "https://pawtech.dk/products/bowl", 1000),
        ad("2", "https://pawtech.dk/collections/all/products/seat?variant=1", 2500),
        ad("3", "https://pawtech.dk/products/seat/"),
      ],
      NOW,
    );
    expect(store).toMatchObject({ reach: 3500, productPaths: ["/products/seat", "/products/bowl"] });
    expect(groupByStore([ad("4", "https://helysta.dk/")], NOW)[0]).not.toHaveProperty("reach");
    expect(productHandle("/collections/x/products/Seat-Cover")).toBe("seat-cover");
    expect(productHandle("/pages/about")).toBeNull();
  });

  it("knows a Shopify store by its /meta.json and reads a product's price, compare-at price and photo", () => {
    expect(readShopMeta({ myshopify_domain: "x.myshopify.com", currency: "DKK", country: "DK" })).toEqual({ currency: "DKK", country: "DK" });
    expect(readShopMeta({ name: "not shopify" })).toBeNull();
    expect(readShopMeta(null)).toBeNull();
    const product = { product: { title: " Hundesæde ", variants: [{ price: "299.00", compare_at_price: "599.00" }], image: { src: "//cdn.shopify.com/s/files/seat.jpg" } } };
    expect(readShopifyProduct(product, "pawtech.dk", "seat")).toEqual({
      handle: "seat",
      url: "https://pawtech.dk/products/seat",
      title: "Hundesæde",
      price: 299,
      compareAt: 599,
      image: "https://cdn.shopify.com/s/files/seat.jpg",
    });
    // A compare-at price no higher than the price isn't a discount.
    expect(readShopifyProduct({ product: { title: "Bowl", variants: [{ price: "99", compare_at_price: "99" }] } }, "pawtech.dk", "bowl")).toEqual({
      handle: "bowl",
      url: "https://pawtech.dk/products/bowl",
      title: "Bowl",
      price: 99,
    });
    expect(readShopifyProduct({ errors: "Not Found" }, "pawtech.dk", "gone")).toBeNull();
  });

  it("filters and sorts the stores the way the page's dropdowns ask", () => {
    const store = (host: string, ads: number, oldestDays: number, extra: Partial<FoundStore> = {}): FoundStore => ({
      host, advertisers: [], ads, copies: ads, oldestDays, offers: [], productPaths: [], sample: [], ...extra,
    });
    const stores = [store("a.dk", 9, 10, { shopify: true, country: "DK" }), store("b.dk", 2, 160, { reach: 90_000, country: "DK" }), store("c.se", 5, 40, { shopify: true, reach: 1000, country: "SE" })];
    expect(filterStores(stores, {}).map((s) => s.host)).toEqual(["a.dk", "c.se", "b.dk"]);
    expect(filterStores(stores, { sort: "days" }).map((s) => s.host)).toEqual(["b.dk", "c.se", "a.dk"]);
    expect(filterStores(stores, { sort: "reach" }).map((s) => s.host)).toEqual(["b.dk", "c.se", "a.dk"]);
    expect(filterStores(stores, { shopifyOnly: true, minAds: 6 }).map((s) => s.host)).toEqual(["a.dk"]);
    expect(filterStores(stores, { minDays: 30, country: "SE" }).map((s) => s.host)).toEqual(["c.se"]);
    // The page's list is left as it was.
    expect(stores.map((s) => s.host)).toEqual(["a.dk", "b.dk", "c.se"]);
  });

  it("shares the daily research out over the countries, every offer in each", () => {
    expect(researchAdsPerCountry(1000, 16)).toBe(63);
    expect(researchAdsPerCountry(50, 16)).toBe(10);
    expect(researchAdsPerCountry(1000, 0)).toBe(0);
    const urls = researchUrls("dk");
    expect(urls).toHaveLength(OFFER_IDS.length);
    expect(decodeURIComponent(urls[2].replace(/\+/g, " "))).toContain('q="gratis fragt"');
  });
});

describe("shortError", () => {
  it("keeps the message and drops Convex's prefix, request id and stack", () => {
    const raw = [
      'Uncaught Error: Apify 403: { "error": { "type": "platform-feature-disabled", "message": "Monthly usage hard limit exceeded" } }',
      "    at startRun (../../convex/apify.ts:124:20)",
      "    at async handler (../../convex/apify.ts:212:18)",
    ].join("\n");
    expect(shortError(raw)).toBe('Apify 403: { "error": { "type": "platform-feature-disabled", "message": "Monthly usage hard limit exceeded" } }');
    expect(shortError("[CONVEX A(apify:startTrackedRun)] [Request ID: abc123] Server Error Uncaught Error: boom at async x")).toBe("boom");
    expect(shortError("plain message")).toBe("plain message");
  });

  it("keeps only ads that show the offer searched for", () => {
    const ad = (headline: string, body = "") => ({ id: "1", pageName: "P", link: "https://x.nl/", headline, body, copies: 1 });
    expect(adShowsOffer(ad("Tijdelijk 2+1 GRATIS"), "bxgy", ["2+1 gratis"])).toBe(true);
    expect(adShowsOffer(ad("3 voor 2!"), "bxgy", ["2+1 gratis"])).toBe(true); // "3 for 2" is the same deal
    expect(adShowsOffer(ad("3 halen, 2 betalen — alleen vandaag"), "bxgy", ["3 halen 2 betalen"])).toBe(true); // the searched words
    expect(adShowsOffer(ad("GoudTour komt naar Oostersportpark!", "Gratis entree"), "bxgy", ["2+1 gratis"])).toBe(false);
    expect(adShowsOffer(ad("Nu 50% korting"), "percent", ["50% korting"])).toBe(true);
    expect(adShowsOffer(ad("Gratis verzending"), "percent", ["50% korting"])).toBe(false);
    // The user's own words: the ad has to contain them.
    expect(adShowsOffer(ad("Wasstrips voor maar €0,21"), null, ["wasstrips"])).toBe(true);
    expect(adShowsOffer(ad("Something else"), null, ["wasstrips"])).toBe(false);
  });

  it("scores how likely a store is a dropshipper, with its reasons", () => {
    const store = (extra: Partial<FoundStore>): FoundStore => ({
      host: "middo.nl", advertisers: ["Middo"], ads: 4, copies: 4, oldestDays: 160, offers: [], productPaths: [], sample: [], ...extra,
    });
    const middo = dropshipScore(
      store({
        shopify: true,
        productCount: 7,
        offers: [{ label: "Buy 2 get 1", count: 4 }, { label: "Limited time", count: 4 }],
        products: [{ handle: "v", url: "u", title: "VitaBoost", price: 24.95, compareAt: 50 }],
      }),
    );
    expect(middo).toEqual({ score: 6, likely: true, reasons: ["Shopify", "7 products", "−50%", "Urgency ads"] });
    // A big catalogue on Shopify without discounts: not likely.
    expect(dropshipScore(store({ shopify: true, productCount: 250 }))).toMatchObject({ score: 2, likely: false, reasons: ["Shopify"] });
    expect(dropshipScore(store({ shopify: true, productCount: 45 })).reasons).toEqual(["Shopify", "45 products"]);
    // Not Shopify (Etos, Hunkemöller): never likely.
    expect(dropshipScore(store({ host: "etos.nl", offers: [{ label: "Ends soon", count: 2 }] }))).toMatchObject({ likely: false });
    // A big brand is never a dropshipper, whatever else it shows.
    expect(dropshipScore(store({ host: "nike.com", advertisers: ["Nike"], shopify: true, productCount: 5 }))).toEqual({ score: 0, likely: false, reasons: ["Big brand"] });
  });

  it("shows likely dropshippers first when asked", () => {
    const store = (host: string, ads: number, dropship: FoundStore["dropship"]): FoundStore => ({
      host, advertisers: [], ads, copies: ads, oldestDays: 1, offers: [], productPaths: [], sample: [], ...(dropship ? { dropship } : {}),
    });
    const stores = [store("etos.nl", 9, { score: 1, likely: false, reasons: [] }), store("middo.nl", 4, { score: 6, likely: true, reasons: [] }), store("relivex.nl", 3, { score: 4, likely: true, reasons: [] })];
    expect(filterStores(stores, { sort: "dropship" }).map((s) => s.host)).toEqual(["middo.nl", "relivex.nl", "etos.nl"]);
    expect(filterStores(stores, { likelyOnly: true }).map((s) => s.host)).toEqual(["middo.nl", "relivex.nl"]);
  });
});
