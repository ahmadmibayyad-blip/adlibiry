import { describe, expect, it } from "vitest";
import {
  adLink,
  adLibrarySearchUrl,
  dailyOfferPhrases,
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
  storeHost,
  toSearchAd,
  type FoundStore,
} from "./offerSearch";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-12T12:00:00Z");

describe("Offer Search", () => {
  it("searches the offer in the country's language, with the user's extra words", () => {
    expect(searchPhrases({ offer: "bxgy", country: "dk" })).toEqual(["køb 2 få 1 gratis", "køb 1 få 1 gratis"]);
    expect(searchPhrases({ offer: "free_shipping", country: "DE", extra: " hund " })).toEqual(["kostenloser Versand hund", "gratis Versand hund"]);
    expect(searchPhrases({ offer: "percent", country: "US" })).toEqual(["50% off", "40% off"]);
    // A country we don't list falls back to English; the user's own phrase wins.
    expect(searchPhrases({ offer: "free_gift", country: "PL" })).toEqual(["free gift"]);
    expect(searchPhrases({ offer: "bxgy", country: "SE", custom: "  3 för 2  ", extra: "katt" })).toEqual(["3 för 2 katt"]);
    // Every offer has phrases in every language our countries use.
    for (const id of OFFER_IDS) for (const c of Object.values(OFFER_COUNTRIES)) expect(OFFERS[id].phrases[c.lang].length, `${id} ${c.lang}`).toBeGreaterThan(0);
  });

  it("gives the daily import one phrase per offer in the country's language", () => {
    expect(dailyOfferPhrases("se")).toEqual([
      { offer: "bxgy", phrase: "köp 2 få 1 gratis" },
      { offer: "percent", phrase: "50% rabatt" },
      { offer: "free_shipping", phrase: "fri frakt" },
      { offer: "free_gift", phrase: "gratis present" },
      { offer: "multibuy", phrase: "köp fler spara mer" },
    ]);
  });

  it("caches by country and phrases, whatever their order or case", () => {
    expect(searchKey("dk", ["Køb 2", "gratis fragt"])).toBe(searchKey("DK", ["gratis fragt", "køb 2"]));
    expect(searchKey("DK", ["køb 2"])).not.toBe(searchKey("SE", ["køb 2"]));
    expect(adLibrarySearchUrl("dk", "køb 2 få 1")).toContain("country=DK&q=k%C3%B8b+2+f%C3%A5+1");
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
    expect(decodeURIComponent(urls[2].replace(/\+/g, " "))).toContain("q=gratis fragt");
  });
});
