import { describe, expect, it } from "vitest";
import { cleanImages, imagesFromHtml, imagesFromShopifyJs, shopifyJsUrl } from "./productImages";

describe("product images", () => {
  it("finds the Shopify product .js url", () => {
    expect(shopifyJsUrl("https://shop.com/collections/dogs/products/cool-mat?variant=1")).toBe("https://shop.com/products/cool-mat.js");
    expect(shopifyJsUrl("https://shop.com/")).toBeNull();
  });

  it("reads Shopify photos", () => {
    expect(imagesFromShopifyJs({ images: ["//cdn.shopify.com/a.jpg", "//cdn.shopify.com/b.jpg"] }, "https://shop.com")).toEqual([
      "https://cdn.shopify.com/a.jpg",
      "https://cdn.shopify.com/b.jpg",
    ]);
    expect(imagesFromShopifyJs({}, "https://shop.com")).toEqual([]);
  });

  it("reads Amazon, social and JSON-LD photos from a page", () => {
    const html = `
      <meta property="og:image" content="https://shop.com/og.jpg">
      <meta name="twitter:image" content="/tw.jpg">
      <script>var data = {"hiRes":"https://m.media-amazon.com/images/I/1.jpg","x":1};</script>
      <script type="application/ld+json">{"@type":"Product","image":["https://shop.com/p1.jpg",{"url":"https://shop.com/p2.jpg"}]}</script>`;
    expect(imagesFromHtml(html, "https://shop.com/item")).toEqual([
      "https://m.media-amazon.com/images/I/1.jpg",
      "https://shop.com/og.jpg",
      "https://shop.com/tw.jpg",
      "https://shop.com/p1.jpg",
      "https://shop.com/p2.jpg",
    ]);
  });

  it("drops duplicates, the main photo, logos and icons", () => {
    expect(
      cleanImages(
        ["https://cdn/a.jpg?v=1", "https://cdn/a.jpg?v=2", "https://cdn/main.jpg", "https://cdn/logo.png", "https://cdn/x.svg", "https://cdn/b.jpg"],
        "https://cdn/main.jpg?width=400",
      ),
    ).toEqual(["https://cdn/a.jpg?v=1", "https://cdn/b.jpg"]);
  });
});
