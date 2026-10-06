import { describe, expect, it } from "vitest";
import { isFetchableUrl, parseAmount, priceFromAdText, priceFromHtml, toUsd } from "./priceParse";

describe("price parsing", () => {
  it("reads amounts in either decimal style", () => {
    expect(parseAmount("1.299,00")).toBe(1299);
    expect(parseAmount("1,299.00")).toBe(1299);
    expect(parseAmount("29,95")).toBe(29.95);
    expect(parseAmount("$19.99")).toBe(19.99);
    expect(parseAmount("0")).toBeUndefined();
  });

  it("reads prices written into ad text", () => {
    expect(priceFromAdText("Product Price: $12.61 · Product Rating: 4.6")).toEqual({ amount: 12.61, currency: "USD" });
    expect(priceFromAdText("Price: €9,99")).toEqual({ amount: 9.99, currency: "EUR" });
    expect(priceFromAdText("GMV $12K")).toBeUndefined();
  });

  it("reads prices from product pages", () => {
    expect(priceFromHtml('<meta property="og:price:amount" content="24.95"><meta property="og:price:currency" content="EUR">')).toEqual({ amount: 24.95, currency: "EUR" });
    expect(priceFromHtml('<meta content="19.00" property="product:price:amount">')).toEqual({ amount: 19, currency: "USD" });
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Mat","offers":{"@type":"Offer","price":"39.90","priceCurrency":"GBP"}}</script>';
    expect(priceFromHtml(ld)).toEqual({ amount: 39.9, currency: "GBP" });
    expect(priceFromHtml('<span itemprop="price" content="12.50"></span><meta itemprop="priceCurrency" content="SEK">')).toEqual({ amount: 12.5, currency: "SEK" });
    expect(priceFromHtml("<html>no price</html>")).toBeUndefined();
  });

  it("converts known currencies and skips unknown ones", () => {
    expect(toUsd({ amount: 100, currency: "USD" })).toBe(100);
    expect(toUsd({ amount: 100, currency: "EUR" })).toBe(108);
    expect(toUsd({ amount: 100, currency: "XYZ" })).toBeUndefined();
  });

  it("only fetches public web pages", () => {
    expect(isFetchableUrl("https://shop.com/products/a")).toBe(true);
    expect(isFetchableUrl("http://localhost:3000/")).toBe(false);
    expect(isFetchableUrl("http://169.254.169.254/latest")).toBe(false);
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("https://intranet/")).toBe(false);
  });
});
