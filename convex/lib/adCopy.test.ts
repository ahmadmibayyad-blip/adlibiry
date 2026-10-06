import { describe, expect, it } from "vitest";
import { cleanAdCopy } from "./adCopy";
import { storeHost, titleSimilarity } from "./productMatch";

describe("ad copy hygiene", () => {
  it("strips page metadata and keeps the call to action separately", () => {
    expect(cleanAdCopy("Keep your dog cool all summer 🐶\nButton: Shop Now\nLink: paws.example.com")).toEqual({
      text: "Keep your dog cool all summer 🐶",
      cta: "Shop Now",
    });
    expect(cleanAdCopy("Sponsored\nLimited stock! Order today. Button: Learn More")).toEqual({ text: "Limited stock! Order today.", cta: "Learn More" });
    expect(cleanAdCopy("Great mat · Library ID: 123456 · Started running on: 1 Oct 2026 · CTA: Buy now")).toEqual({ text: "Great mat", cta: "Buy now" });
  });

  it("leaves normal copy alone", () => {
    const text = "Our best seller: the cooling mat. Link up with 10,000 happy dogs!";
    expect(cleanAdCopy(text)).toEqual({ text });
    expect(cleanAdCopy("")).toEqual({ text: "" });
  });
});

describe("same store, same product", () => {
  it("knows shops from marketplaces and compares titles word by word", () => {
    expect(storeHost("https://www.paws.example.com/products/x")).toBe("paws.example.com");
    expect(storeHost("https://www.amazon.com/dp/B0ABCDEF12")).toBeNull();
    expect(storeHost("not a url")).toBeNull();
    expect(titleSimilarity("Dog Cooling Mat for Large Dogs", "Large dog cooling mat")).toBe(1);
    expect(titleSimilarity("Dog Cooling Mat Blue", "Dog Cooling Mat Pink")).toBeLessThan(0.7);
  });
});
