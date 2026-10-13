import { describe, expect, it } from "vitest";
import { DEFAULT_SECTIONS, mirrorPlan, mirrorSections, mirrorTiers } from "./pageMirror";
import type { BundleTier, Teardown } from "./storeTeardown";

const tier = (t: Partial<BundleTier> & Pick<BundleTier, "deal">): BundleTier => ({ title: "x", freeGifts: [], freeShipping: false, preselected: false, ...t });

const teardown: Teardown = {
  productPath: "/products/fodstotte",
  productTitle: "Fodstøtte 2.0",
  bundle: {
    app: "Kaching Bundles",
    tiers: [
      tier({ title: "1 stk", quantity: 1, deal: { kind: "none" } }),
      tier({ title: "Køb 1 få 1 gratis", deal: { kind: "buyXgetY", buy: 1, get: 1 }, badge: "Mest populær", preselected: true }),
      tier({ title: "3 stk", quantity: 3, deal: { kind: "percent", value: 30 }, freeGifts: ["E-bog"] }),
    ],
  },
  features: [
    { key: "sticky_atc", label: "Sticky add-to-cart" },
    { key: "countdown", label: "Countdown timer" },
    { key: "guarantee", label: "Money-back guarantee", evidence: "30 dages pengene tilbage" },
    { key: "customer_claim", label: "Customer-count claim" },
  ],
  sections: [
    { id: "banner", label: "Banner" },
    { id: "main", label: "Buy box" },
    { id: "image_with_text_1", label: "Image with text" },
    { id: "multicolumn", label: "Benefits / icons" },
    { id: "compare", label: "Comparison" },
    { id: "1712345678abcdef", label: "Reviews (app)" },
    { id: "image_with_text_2", label: "Image with text" },
    { id: "image_with_text_3", label: "Image with text" },
    { id: "collapsible", label: "FAQ / accordion" },
    { id: "related", label: "Related products" },
  ],
};

describe("Mirror a page", () => {
  it("copies the order of the sections under the buy box, up to 3 photo rows", () => {
    expect(mirrorSections(teardown.sections)).toEqual(["row", "row", "comparison", "reviews", "row", "faq"]);
  });

  it("copies the bundle deals as items and % off, with the chosen deal and its badge", () => {
    expect(mirrorTiers(teardown.bundle!.tiers)).toEqual({ tiers: [{ qty: 1, off: 0 }, { qty: 2, off: 50 }, { qty: 3, off: 30 }], preselect: 2, badges: [2] });
    // Deals of different products, or with no saving, can't be quantity discounts.
    expect(mirrorTiers([tier({ deal: { kind: "none" } }), tier({ deal: { kind: "bundle", items: 2 } })])).toBeNull();
    expect(mirrorTiers([tier({ deal: { kind: "none" } }), tier({ quantity: 2, deal: { kind: "none" } })])).toBeNull();
    // Fixed prices use our arithmetic; quantities out of order are dropped; at most 3 deals.
    expect(
      mirrorTiers([
        tier({ quantity: 2, deal: { kind: "price", value: 400 }, percentOff: 20 }),
        tier({ quantity: 1, deal: { kind: "none" } }),
        tier({ quantity: 4, deal: { kind: "percent", value: 95 } }),
        tier({ quantity: 6, deal: { kind: "percent", value: 40 } }),
        tier({ quantity: 8, deal: { kind: "percent", value: 50 } }),
      ]),
    ).toEqual({ tiers: [{ qty: 2, off: 20 }, { qty: 4, off: 70 }, { qty: 6, off: 40 }], preselect: 2, badges: [] });
  });

  it("plans the page: structure and offer copied, fake urgency and claims left out", () => {
    const plan = mirrorPlan("https://www.komforttid.dk/products/fodstotte", teardown);
    expect(plan).toMatchObject({
      host: "komforttid.dk",
      tiers: [{ qty: 1, off: 0 }, { qty: 2, off: 50 }, { qty: 3, off: 30 }],
      preselect: 2,
      badges: [2],
      sections: ["row", "row", "comparison", "reviews", "row", "faq"],
      sticky: true,
      delivery: false,
      guarantee: true,
    });
    expect(plan.copied.join("\n")).toContain("Bundle deals: 1 item, 2 items −50%, 3 items −30%, deal 2 chosen first, badge on deal 2");
    expect(plan.copied.join("\n")).toContain("Section order: Photo + text → Photo + text → Comparison table → Reviews → Photo + text → FAQ");
    expect(plan.skipped.join("\n")).toMatch(/Countdown timer.*not copied/);
    expect(plan.skipped.join("\n")).toMatch(/Free gifts/);
    expect(plan.skipped.join("\n")).toMatch(/customer-count claim/);
  });

  it("adds reviews when the page shows none, and falls back to our layout when it can't be read", () => {
    const noReviews = mirrorPlan("https://x.dk/products/a", { ...teardown, sections: teardown.sections.filter((s) => !s.label.startsWith("Reviews")) });
    expect(noReviews.sections).toEqual(["row", "row", "comparison", "row", "reviews", "faq"]);
    const builder = mirrorPlan("https://x.dk/products/a", { ...teardown, bundle: undefined, sections: [{ id: "gp-section-1", label: "GemPages section" }] });
    expect(builder.sections).toEqual(DEFAULT_SECTIONS);
    expect(builder).toMatchObject({ sticky: true, delivery: true, guarantee: true });
    expect(builder.tiers).toBeUndefined();
    expect(builder.skipped.join("\n")).toMatch(/couldn't be read/);
    const unread = mirrorPlan("https://x.dk/products/a", null);
    expect(unread).toMatchObject({ sections: DEFAULT_SECTIONS, sticky: true, delivery: true, guarantee: true, copied: [] });
  });
});
