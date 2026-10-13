import { describe, expect, it } from "vitest";
import { analysisText, cleanAnalysis, storeEvidence } from "./storeAnalysis";
import type { Inspection } from "./storeInspect";

const inspection: Inspection = {
  shopify: true,
  shopName: "Komfort Tid",
  country: "DK",
  currency: "DKK",
  locale: "da",
  theme: { name: "Refresh", schemaName: "Refresh", version: "15.4.1", vendor: "Shopify", free: true },
  apps: [{ key: "kaching", name: "Kaching Bundles", category: "Bundles & upsells", via: "app embed" }],
  pixels: ["Meta (Facebook) pixel"],
  teardown: {
    productPath: "/products/fodstotte-2-0",
    productTitle: "Fodstøtte 2.0",
    price: { price: 299, currency: "DKK" },
    bundle: {
      app: "Kaching Bundles",
      tiers: [
        { title: "Køb 1 Få 1 Gratis", quantity: 2, deal: { kind: "buyXgetY", buy: 1, get: 1 }, percentOff: 50, freeGifts: [], freeShipping: false, preselected: true },
        { title: "Køb 2 Få 2 Gratis", quantity: 4, deal: { kind: "buyXgetY", buy: 2, get: 2 }, badge: "Mest populær", freeGifts: ["E-bog"], freeShipping: true, preselected: false },
      ],
    },
    features: [{ key: "countdown", label: "Countdown", evidence: "Tilbuddet slutter i dag" }],
    sections: [{ id: "main", label: "Product info" }, { id: "faq", label: "FAQ" }],
  },
};

describe("AI store analysis", () => {
  it("gives the AI the store's facts and its ads, numbers labelled as the page's", () => {
    const text = storeEvidence("komforttid.dk", inspection, [
      { headline: "Køb 1 – Få 1 GRATIS (Kun i dag!)", body: "Ondt i fødderne?", daysRunning: 168, country: "DK", isActive: true },
      { headline: "Fodstøtte 2.0", body: "Køb 1 få 1 gratis", daysRunning: 20, country: "DK" },
    ]);
    expect(text).toContain("Theme: Refresh v15.4.1, a free theme");
    expect(text).toContain("Apps: Kaching Bundles (Bundles & upsells)");
    expect(text).toContain('- "Køb 1 Få 1 Gratis", 2 units, buy 1 get 1 (≈50% off by our math), preselected');
    expect(text).toContain('badge "Mest populær"');
    expect(text).toContain("free gift: E-bog");
    expect(text).toContain("Reviews: none in the page's HTML");
    expect(text).toContain('Countdown ("Tilbuddet slutter i dag")');
    expect(text).toContain("Ads AdSpy has for this store: 2 (2 active), the longest running 168 days");
    expect(text).toMatch(/Offers in the ads: .*Buy 1 get 1 \(2\)/);
    expect(storeEvidence("x.dk", { shopify: false, apps: [], pixels: [] })).toContain("Ads: AdSpy has none for this store yet.");
  });

  it("keeps the AI's answer to the card's sizes, and writes it out as text", () => {
    const a = cleanAnalysis({
      verdict: "  A focused  buy-1-get-1 store.  ",
      strengths: [{ point: "Bundles", evidence: "2 Kaching tiers" }, { point: "", evidence: "x" }, ...Array(8).fill({ point: "p", evidence: "e" })],
      copy: ["a", "b"],
      beat: "not a list",
      weaknesses: ["w"],
      warnings: ["“Kun i dag” has run 168 days"],
    });
    expect(a.verdict).toBe("A focused buy-1-get-1 store.");
    expect(a.strengths).toHaveLength(6);
    expect(a.beat).toEqual([]);
    expect(a.missing).toEqual([]);
    expect(analysisText("komforttid.dk", a)).toContain("Don't copy:\n- “Kun i dag” has run 168 days");
  });
});
