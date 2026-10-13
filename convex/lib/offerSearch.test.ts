import { describe, expect, it } from "vitest";
import { adLink, adLibrarySearchUrl, dailyOfferPhrases, groupByStore, OFFER_COUNTRIES, OFFER_IDS, OFFERS, searchKey, searchPhrases, storeHost, toSearchAd } from "./offerSearch";

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
