import { describe, expect, it } from "vitest";
import { DAWN_BINARY, DAWN_FILES } from "./lib/dawnFiles.generated";
import { DAWN_FONTS, dawnOverrides, dawnThemeFiles } from "./lib/dawnTheme";
import { BUNDLE_OFF, cleanProductPage, cleanStore, type StoreCopy, type ThemeInput } from "./lib/storeKit";
import { STORE_STYLE_IDS } from "./lib/storeStyles";
import { mirrorPlan } from "./lib/pageMirror";
import { zipFiles } from "./lib/zip";
import { readDawn } from "../scripts/build-theme.mjs";

const copy: StoreCopy = cleanStore({
  announcement: "Free shipping from 299 kr.",
  hero: { eyebrow: "New", heading: "Sit straighter, all day", text: "A light brace for desk days.", button: "Shop now", points: ["Light"] },
  trust: [{ icon: "truck", text: "Delivery in 5–8 days" }, { icon: "return", text: "30-day returns" }, { icon: "clock", text: "Fast replies" }, { icon: "star", text: "Fourth" }],
  benefits: { heading: "Why it helps", text: "", items: [{ icon: "leaf", title: "Breathable", text: "Soft mesh & light." }] },
  steps: { heading: "How it works", items: [{ title: "Put it on", text: "Over or under your shirt." }, { title: "Adjust", text: "Pull the straps." }] },
  story: { eyebrow: "Our pick", heading: "Why we sell it", paragraphs: ["We tried a dozen."], button: "About us" },
  faq: { heading: "Questions", items: [{ q: "How long is delivery?", a: "5–8 business days." }] },
  newsletter: { heading: "Stay in the loop", text: "New products, no spam." },
  footerText: "Posture gear <that> works.",
  productTrust: { shipping: "Delivery in 5–8 days", returns: "30-day returns", payment: "Secure checkout" },
  pages: { about: { title: "About", paragraphs: ["x"] }, shipping: { title: "Shipping", paragraphs: ["x"] }, faq: { title: "FAQ" }, contact: { title: "Contact", intro: "x" } },
  menu: { home: "Home", shop: "Shop", about: "About", faq: "FAQ", contact: "Contact", shipping: "Shipping", search: "Search" },
});
const input = (style: ThemeInput["style"] = "nordic"): ThemeInput => ({
  style,
  brandName: "Rank Ryg",
  productHandle: "rank-ryg",
  pageHandles: { about: "about-1" },
  copy,
  product: { title: "Rank Ryg Posture Brace" },
  facts: { shippingTime: "5–8 business days", returnDays: 30, currency: "DKK" },
});

type Setting = { id?: string; type: string; options?: { value: string }[] };
type Schema = { settings?: Setting[]; blocks?: { type: string; settings?: Setting[] }[]; enabled_on?: unknown };

function sectionSchema(type: string): Schema {
  const src = DAWN_FILES[`sections/${type}.liquid`];
  expect(src, `sections/${type}.liquid exists`).toBeTruthy();
  return JSON.parse(src.split("{% schema %}")[1].split("{% endschema %}")[0]);
}

function checkSettings(defs: Setting[] | undefined, values: Record<string, unknown> | undefined, where: string) {
  for (const [id, value] of Object.entries(values ?? {})) {
    const def = defs?.find((d) => d.id === id);
    expect(def, `${where}: setting "${id}" exists`).toBeTruthy();
    if (def?.options) expect(def.options.map((o) => o.value), `${where}: "${id}" = ${String(value)}`).toContain(value);
  }
}

type SectionJson = { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown> }>; block_order?: string[] };

function checkSections(sections: Record<string, SectionJson>, order: string[], where: string) {
  for (const key of order) expect(sections[key], `${where}: ${key} in order`).toBeTruthy();
  for (const [key, s] of Object.entries(sections)) {
    const schema = sectionSchema(s.type);
    checkSettings(schema.settings, s.settings, `${where} ${key}`);
    for (const id of s.block_order ?? []) expect(s.blocks?.[id], `${where} ${key}: block ${id}`).toBeTruthy();
    for (const [id, b] of Object.entries(s.blocks ?? {})) {
      const blockSchema = schema.blocks?.find((x) => x.type === b.type);
      expect(blockSchema, `${where} ${key}: block type ${b.type}`).toBeTruthy();
      checkSettings(blockSchema?.settings, b.settings, `${where} ${key}.${id}`);
    }
  }
}

describe("Dawn theme", () => {
  it("is bundled from shopify-theme-dawn/ (run node scripts/build-theme.mjs after editing it)", () => {
    const { files, binary } = readDawn();
    expect(DAWN_FILES).toEqual(files);
    expect(DAWN_BINARY).toEqual(binary);
    // Dawn's license has to travel with every copy.
    expect(DAWN_FILES["snippets/dawn-license.liquid"]).toContain("Copyright (c) 2021-present Shopify Inc.");
  });

  it("writes only sections, blocks, settings and options that Dawn has, for every style", () => {
    for (const style of STORE_STYLE_IDS) {
      const files = dawnOverrides(input(style));
      for (const path of ["templates/index.json", "templates/product.json", "sections/header-group.json", "sections/footer-group.json"]) {
        const j = JSON.parse(files[path]) as { sections: Record<string, SectionJson>; order: string[] };
        checkSections(j.sections, j.order, `${style} ${path}`);
      }
      const settings = JSON.parse(files["config/settings_data.json"]).current as Record<string, unknown>;
      const ids = new Set(
        (JSON.parse(DAWN_FILES["config/settings_schema.json"]) as { settings?: Setting[] }[]).flatMap((g) => (g.settings ?? []).map((s) => s.id)),
      );
      // Dawn's preset also carries its static sections' settings ("sections").
      for (const id of Object.keys(settings).filter((k) => k !== "sections")) expect(ids.has(id), `${style}: theme setting ${id}`).toBe(true);
      expect(settings).toMatchObject({ type_header_font: DAWN_FONTS[style].head, type_body_font: DAWN_FONTS[style].body, cart_type: "drawer" });
    }
  });

  it("fills Dawn's home page with the store copy and links the product and pages", () => {
    const files = dawnOverrides(input());
    const home = JSON.parse(files["templates/index.json"]);
    expect(home.order).toEqual(["hero", "product", "benefits", "steps", "story", "reviews", "faq", "newsletter"]);
    expect(home.sections.product.settings.product).toBe("rank-ryg");
    expect(home.sections.hero.blocks.h4.settings.button_link).toBe("shopify://products/rank-ryg");
    expect(home.sections.story.blocks.t4.settings.button_link).toBe("/pages/about-1");
    // Dawn has three icon slots; the fourth trust line is left out, unknown icons get a fallback.
    expect(home.sections.product.blocks.trust.settings).toMatchObject({ icon_1: "truck", heading_1: "Delivery in 5–8 days", icon_2: "return", icon_3: "stopwatch" });
    const footer = JSON.parse(files["sections/footer-group.json"]);
    expect(footer.sections.footer.blocks.l1.settings.subtext).toBe("<p>Posture gear &lt;that&gt; works.</p>");
    expect(JSON.parse(files["sections/header-group.json"]).sections.header.settings.menu).toBe("adspy-main");
    // Our product page additions sit right after Dawn's buy box.
    const product = JSON.parse(files["templates/product.json"]);
    expect(product.order.slice(0, 4)).toEqual(["main", "adspy_testimonials", "adspy_reviews", "adspy_faq"]);
    expect(product.sections.main.block_order).toContain("adspy_benefits");
    // Dawn's multicolumn shows a "Button label" button unless the label is blanked.
    expect(home.sections.benefits.settings.button_label).toBe("");
    expect(home.sections.steps.settings.button_label).toBe("");
    // Liquid settings only see global objects: the home page finds its product by handle.
    expect(home.sections.product.blocks.benefits.settings.custom_liquid).toContain("assign p = all_products['rank-ryg']");
    expect(product.sections.main.blocks.adspy_benefits.settings.custom_liquid).toContain("assign p = product");
  });

  it("builds Dawn's product page like the stores selling with ads, with bundle deals only when the discounts exist", () => {
    const productPage = cleanProductPage({
      ticks: ["Rank ryg – uden at tænke over det", "Blød polstring"],
      offer: "Spar op til 25 % når du køber flere",
      bundles: { heading: "Køb flere", tiers: [{ title: "1 stk.", subtitle: "" }, { title: "2 stk.", subtitle: "Kun [unit] pr. stk." }, { title: "3 stk.", subtitle: "" }], popular: "Mest populær", best: "Bedste pris" },
      sections: [
        { eyebrow: "Problemet", heading: "Ondt i nakken?", text: "Mange sidder krumbøjede.", points: ["Træt ryg"] },
        { eyebrow: "Løsningen", heading: "Blid støtte", text: "Remmene minder dig om det.", points: [] },
      ],
      comparison: { heading: "Hvorfor os", others: "Almindelig bandage", rows: [{ feature: "Justerbar", us: "yes", others: "partly" }, { feature: "Usynlig", us: "yes", others: "no" }, { feature: "Åndbar", us: "yes", others: "no" }] },
      tabs: [{ heading: "Materialer", text: "Neopren <og> nylon." }],
      button: "Bestil nu",
      reviewsHeading: "Det siger kunderne",
    })!;
    const withDeals = JSON.parse(dawnOverrides({ ...input(), copy: { ...copy, productPage }, bundleOff: [...BUNDLE_OFF], aiPhotos: 1 })["templates/product.json"]) as { sections: Record<string, SectionJson>; order: string[] };
    checkSections(withDeals.sections, withDeals.order, "product.json with deals");
    const main = withDeals.sections.main;
    expect(main.block_order).toEqual([
      "adspy_rating", "title", "price", "adspy_benefits", "adspy_offer", "adspy_stock", "variant_picker", "adspy_bundles", "buy_buttons",
      "adspy_guarantee", "adspy_trust", "description", "adspy_tab1", "share",
    ]);
    // The deal sets the quantity, so Dawn's quantity selector goes.
    expect(main.blocks?.quantity_selector).toBeUndefined();
    expect(main.blocks?.adspy_bundles.settings).toMatchObject({ tier2_off: 15, tier3_off: 25, tier2_badge: "Mest populær", tier2_subtitle: "Kun [unit] pr. stk." });
    expect(main.blocks?.adspy_guarantee.settings).toMatchObject({ days: 30 });
    expect(main.blocks?.adspy_benefits.settings?.custom_liquid).toContain("<strong>Rank ryg</strong> – uden at tænke over det");
    expect(main.blocks?.adspy_tab1.settings?.content).toBe("<p>Neopren &lt;og&gt; nylon.</p>");
    expect(withDeals.order).toEqual(["main", "adspy_problem", "adspy_comparison", "adspy_row2", "adspy_testimonials", "adspy_reviews", "adspy_faq", "disclosures", "related-products"]);
    // Rows show the AI photo (the 2nd photo), the comparison names our store.
    expect(withDeals.sections.adspy_problem.settings).toMatchObject({ image_index: 2, heading: "Ondt i nakken?" });
    expect(withDeals.sections.adspy_comparison.settings).toMatchObject({ us_label: "Rank Ryg", them_1: "Almindelig bandage" });

    // Without Launch's discounts: no deals and no offer line, Dawn's quantity selector stays.
    const plain = JSON.parse(dawnOverrides({ ...input(), copy: { ...copy, productPage } })["templates/product.json"]) as { sections: Record<string, SectionJson> };
    checkSections(plain.sections, Object.keys(plain.sections), "product.json without deals");
    expect(plain.sections.main.block_order).toContain("quantity_selector");
    expect(plain.sections.main.block_order).not.toContain("adspy_bundles");
    expect(plain.sections.main.block_order).not.toContain("adspy_offer");
    expect(plain.sections.adspy_problem.settings).toMatchObject({ image_index: 1 });
  });

  it("lays Dawn's product page out like a mirrored page", () => {
    const productPage = cleanProductPage({
      ticks: ["Rank ryg – uden at tænke over det"],
      offer: "Spar op til 30 %",
      bundles: { heading: "Køb flere", tiers: [{ title: "2 stk.", subtitle: "" }, { title: "4 stk.", subtitle: "" }], popular: "Mest populær", best: "Bedste pris" },
      sections: [{ eyebrow: "Problemet", heading: "Ondt i nakken?", text: "Mange sidder krumbøjede.", points: [] }],
      comparison: { heading: "Hvorfor os", others: "Bandage", rows: [{ feature: "A", us: "yes", others: "no" }, { feature: "B", us: "yes", others: "no" }, { feature: "C", us: "yes", others: "no" }] },
      tabs: [],
      button: "Bestil nu",
      reviewsHeading: "Det siger kunderne",
    })!;
    const mirror = { ...mirrorPlan("https://rival.dk/products/a", null), tiers: [{ qty: 2, off: 10 }, { qty: 4, off: 30 }], preselect: 2, badges: [2], sections: ["faq" as const, "comparison" as const, "row" as const, "reviews" as const], guarantee: false };
    const tpl = JSON.parse(dawnOverrides({ ...input(), copy: { ...copy, productPage }, bundleOff: [10, 30], bundleQty: [2, 4], mirror })["templates/product.json"]) as { sections: Record<string, SectionJson>; order: string[] };
    checkSections(tpl.sections, tpl.order, "mirrored product.json");
    expect(tpl.order.slice(0, 6)).toEqual(["main", "adspy_faq", "adspy_comparison", "adspy_problem", "adspy_testimonials", "adspy_reviews"]);
    expect(tpl.sections.main.block_order).not.toContain("adspy_guarantee");
    expect(tpl.sections.main.blocks?.adspy_bundles.settings).toMatchObject({ preselect: "2", tier1_qty: 2, tier2_qty: 4, tier2_badge: "Mest populær", tier3_qty: 0 });
  });

  it("keeps our names within Shopify's 25 characters and labels within 70 (longer ones make Shopify drop the section and its templates)", () => {
    for (const [path, src] of Object.entries(DAWN_FILES)) {
      if (!/^sections\/(adspy-|main-product)/.test(path)) continue;
      const schema = JSON.parse(src.split("{% schema %}")[1].split("{% endschema %}")[0]) as { name?: string; settings?: { label?: string }[]; blocks?: { name?: string; settings?: { label?: string }[] }[] };
      for (const name of [schema.name, ...(schema.blocks ?? []).map((b) => b.name)]) {
        if (name && !name.startsWith("t:")) expect(name.length, `${path}: "${name}"`).toBeLessThanOrEqual(25);
      }
      for (const st of [...(schema.settings ?? []), ...(schema.blocks ?? []).flatMap((b) => b.settings ?? [])]) {
        const label = st.label ?? "";
        if (!label.startsWith("t:")) expect(label.length, `${path}: "${label}"`).toBeLessThanOrEqual(70);
      }
    }
  });

  it("has an order tracking page for the page Launch creates", () => {
    const j = JSON.parse(DAWN_FILES["templates/page.track.json"]) as { sections: Record<string, SectionJson>; order: string[] };
    checkSections(j.sections, j.order, "page.track.json");
    expect(j.sections.track.settings?.custom_liquid).toContain("17track.net");
  });

  it("zips Dawn with the store's files on top, binary files intact", () => {
    const files = dawnThemeFiles(input());
    expect(Object.keys(files).length).toBe(Object.keys(DAWN_FILES).length + Object.keys(DAWN_BINARY).length);
    const gif = files["assets/sparkle.gif"] as Uint8Array;
    expect(new TextDecoder().decode(gif.subarray(0, 3))).toBe("GIF");
    expect(zipFiles(files).length).toBeGreaterThan(gif.length);
  });

  it("has the AdSpy strings in every language our launches write", () => {
    const used = new Set(
      [...Object.entries(DAWN_FILES).filter(([p]) => p.startsWith("sections/adspy-") || p.startsWith("snippets/adspy-") || p === "templates/page.track.json").map(([, s]) => s).join("\n").matchAll(/'(adspy\.[a-z_]+)' \| t\b/g)].map((m) => m[1].split(".")[1]),
    );
    expect(used.size).toBeGreaterThan(4);
    for (const loc of ["en.default", "da", "de", "es", "fi", "fr", "it", "nb", "nl", "pl", "pt-BR", "pt-PT", "sv"]) {
      const strings = JSON.parse(DAWN_FILES[`locales/${loc}.json`]).adspy ?? {};
      for (const key of used) expect(strings[key], `${loc}: adspy.${key}`).toBeTruthy();
    }
  });
});
