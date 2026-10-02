import { describe, expect, it } from "vitest";
import { descriptionHtml, normalizeShopDomain, productCsv, productSetInput, sellingPrice, videoFileName } from "./shopifyExport";

const product = {
  title: 'Dog Cooling Mat, "Large"',
  description: "Keeps dogs cool.\n\nNo water <or> power needed.",
  imageUrl: "https://cdn.example.com/mat.jpg",
  price: 34.9,
  cost: 9.5,
  category: "Pet Supplies",
  tags: ["summer", "dogs", "summer"],
};

describe("shopify export", () => {
  it("normalises store addresses", () => {
    expect(normalizeShopDomain("https://My-Store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("my-store")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("mystore.com")).toBeNull();
  });

  it("escapes the description into paragraphs", () => {
    expect(descriptionHtml(product.description)).toBe("<p>Keeps dogs cool.</p><p>No water &lt;or&gt; power needed.</p>");
  });

  it("prices from cost when there is no price", () => {
    expect(sellingPrice({ ...product, price: undefined })).toBe("23.75");
    expect(sellingPrice({ ...product, price: undefined, cost: undefined })).toBeUndefined();
  });

  it("builds a draft productSet input", () => {
    expect(productSetInput(product)).toEqual({
      title: product.title,
      descriptionHtml: "<p>Keeps dogs cool.</p><p>No water &lt;or&gt; power needed.</p>",
      productType: "Pet Supplies",
      tags: ["summer", "dogs", "Pet Supplies"],
      status: "DRAFT",
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
      variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }], price: "34.90", inventoryItem: { cost: "9.50" } }],
      files: [{ originalSource: product.imageUrl, contentType: "IMAGE", alt: product.title }],
    });
    expect(productSetInput({ ...product, imageUrl: "data:x" })).not.toHaveProperty("files");
  });

  it("writes an importable CSV with quoted cells", () => {
    const [header, row] = productCsv(product).trim().split("\n");
    expect(header.startsWith("Handle,Title,Body (HTML)")).toBe(true);
    expect(row).toContain('dog-cooling-mat-large,"Dog Cooling Mat, ""Large"""');
    expect(row).toContain(",34.90,deny,manual,TRUE,9.50,https://cdn.example.com/mat.jpg,1,draft");
  });

  it("names video files after the advertiser", () => {
    expect(videoFileName("Paw & Co!")).toBe("paw-co-ad.mp4");
  });
});
