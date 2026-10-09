import { describe, expect, it } from "vitest";
import { fromAliExpressApi, fromAliExpressHtml, fromProductHtml, fromShopifyJs, importSource, productUrl } from "./productImport";

describe("Launch from a link", () => {
  it("accepts public product links and tells where they're from", () => {
    expect(productUrl("javascript:alert(1)")).toBeNull();
    expect(productUrl("http://localhost/products/x")).toBeNull();
    expect(productUrl("https://10.0.0.1/x")).toBeNull();
    const ali = productUrl("https://www.aliexpress.com/item/1005012573349832.html?spm=x#reviews")!;
    expect(ali.hash).toBe("");
    expect(importSource(ali)).toBe("aliexpress");
    expect(importSource(productUrl("https://pets-dreams.uk/collections/dogs/products/snufflemaster?variant=1")!)).toBe("shopify");
    expect(importSource(productUrl("https://shop.example.com/item/42")!)).toBe("web");
  });

  it("reads a Shopify store's product, with its price in USD", () => {
    const p = fromShopifyJs(
      { title: "SnuffleMaster", description: "<p>Hide treats &amp; let your dog <b>sniff</b>.</p>", price: 2999, images: ["//cdn.shopify.com/a.jpg", "//cdn.shopify.com/b.jpg"] },
      "https://pets-dreams.uk/products/snufflemaster",
      "USD",
    );
    expect(p).toEqual({ source: "shopify", title: "SnuffleMaster", description: "Hide treats & let your dog sniff .", imageUrl: "https://cdn.shopify.com/a.jpg", images: ["https://cdn.shopify.com/b.jpg"], price: 29.99 });
    expect(fromShopifyJs({ title: "" }, "https://x.com/products/y")).toBeNull();
  });

  it("reads an AliExpress page's title and photos", () => {
    const html = `<meta property="og:title" content="New Pet Dog Brush Cat Comb Self Cleaning - AliExpress 15"><meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg">
      <script>window.runParams = {"imagePathList":["https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg","https://ae-pic-a1.aliexpress-media.com/kf/S2.png"]}</script>`;
    expect(fromAliExpressHtml(html)).toEqual({
      source: "aliexpress", title: "New Pet Dog Brush Cat Comb Self Cleaning", description: "",
      imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg", images: ["https://ae-pic-a1.aliexpress-media.com/kf/S2.png"],
    });
    expect(fromAliExpressApi({ aliexpress_affiliate_productdetail_get_response: { resp_result: { result: { products: { product: [
      { target_sale_price: "4.37", product_main_image_url: "https://ae/1.jpg", product_small_image_urls: { string: ["https://ae/2.jpg"] }, product_title: "Brush" },
    ] } } } } })).toEqual({ cost: 4.37, images: ["https://ae/1.jpg", "https://ae/2.jpg"], title: "Brush" });
  });

  it("reads any shop's product tags", () => {
    const html = `<title>Ignored</title><meta property="og:image" content="https://shop.example.com/m.jpg">
      <meta property="product:price:amount" content="249.00"><meta property="product:price:currency" content="DKK">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Mikrofiberrulle","description":"50 genbrugelige klude"}</script>`;
    const p = fromProductHtml(html, "https://shop.example.com/item/42")!;
    expect(p).toMatchObject({ source: "web", title: "Mikrofiberrulle", description: "50 genbrugelige klude", imageUrl: "https://shop.example.com/m.jpg" });
    expect(p.price).toBeGreaterThan(20);
    expect(fromProductHtml("<p>no product</p>", "https://x.com/")).toBeNull();
    expect(fromProductHtml(`<title>My blog</title><meta property="og:type" content="article">`, "https://x.com/post")).toBeNull();
    expect(fromProductHtml(`<meta property="og:type" content="product"><meta property="og:title" content="Lamp">`, "https://x.com/lamp")?.title).toBe("Lamp");
  });
});
