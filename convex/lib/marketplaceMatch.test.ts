import { describe, expect, it } from "vitest";
import { fieldsOf, pickAmazonTwin, pickWholesale } from "./marketplaceMatch";
import { describeMetaError, metaCountries } from "./metaAdLibrary";

describe("Nexscope image matches", () => {
  it("takes the first real Amazon listing as the twin, whatever the field names", () => {
    const twin = pickAmazonTwin([
      { title: "no asin" },
      { ASIN: "b0abc12345", productTitle: "Posture Corrector for Women", currentPrice: "$24.99", monthly_sales: 3200, mainImage: "https://m.media-amazon.com/x.jpg" },
    ]);
    expect(twin).toEqual({
      asin: "B0ABC12345",
      title: "Posture Corrector for Women",
      url: "https://www.amazon.com/dp/B0ABC12345",
      price: 24.99,
      unitsPerMonth: 3200,
      imageUrl: "https://m.media-amazon.com/x.jpg",
    });
    expect(pickAmazonTwin([{ asin: "short", title: "x" }])).toBeNull();
  });

  it("converts 1688 offers from yuan and keeps the 3 cheapest", () => {
    const offers = pickWholesale(
      [
        { subject: "Posture belt A", price: "35.5", offerId: "111", moq: 2, monthSold: 900 },
        { title: "Posture belt B", priceInfo: { price: 14.2 }, detailUrl: "https://detail.1688.com/offer/222.html" },
        { title: "Posture belt C", price: 71, url: "https://detail.1688.com/offer/333.html" },
        { title: "Posture belt D", price: 21.3, url: "https://detail.1688.com/offer/444.html" },
        { title: "no price", url: "https://detail.1688.com/offer/555.html" },
      ],
      7.1,
    );
    expect(offers.map((o) => o.priceUsd)).toEqual([2, 3, 5]);
    expect(offers[2]).toMatchObject({ title: "Posture belt A", url: "https://detail.1688.com/offer/111.html", moq: 2, monthlySales: 900 });
  });

  it("names the fields of a reply it couldn't read", () => {
    expect(fieldsOf([{ foo: 1, bar: 2 }])).toBe("foo, bar");
    expect(fieldsOf([])).toBe("no items");
  });
});

describe("Meta Ad Library limits", () => {
  it("keeps EU and UK countries and explains the rest", () => {
    expect(metaCountries("DE,FR,US,UK,CA")).toEqual({ use: ["DE", "FR", "GB"], skipped: ["US", "CA"] });
    expect(metaCountries(undefined).use).toEqual(["DK", "SE", "DE", "NL", "FR"]);
  });

  it("explains errors and says when to stop or retry", () => {
    expect(describeMetaError({ code: 190, message: "Session has expired" }, 400)).toMatchObject({ stop: true, retry: false });
    expect(describeMetaError({ code: 190 }, 400).message).toMatch(/token expired or invalid/);
    expect(describeMetaError({ code: 10 }, 400)).toMatchObject({ stop: true });
    expect(describeMetaError({ code: 10 }, 400).message).toMatch(/facebook\.com\/ID/);
    expect(describeMetaError({ code: 613 }, 400)).toMatchObject({ stop: false, retry: true });
    expect(describeMetaError(undefined, 500)).toMatchObject({ stop: false, retry: false });
  });
});
