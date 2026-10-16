/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { THEME_FILES } from "./lib/themeFiles.generated";
import { styleSettings } from "./lib/storeKit";
import { BUNDLE_OFF, DEFAULT_TIERS, capDeals, cleanProductPage, cleanStore, cleanTimeline, deliveryDays, menuLabel, productTemplate, storeMenus, storePages, themeFiles, themeOverrides, type StoreCopy, type ThemeInput } from "./lib/storeKit";
import { STORE_STYLES, STORE_STYLE_IDS } from "./lib/storeStyles";
import { mirrorPlan } from "./lib/pageMirror";
import type { HomeSection } from "./lib/siteMirror";
import { crc32, zipFiles } from "./lib/zip";
import { readTheme } from "../scripts/build-theme.mjs";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const storeCopy: StoreCopy = {
  announcement: "Free shipping from 299 kr.",
  hero: { eyebrow: "New", heading: "Sit straighter, all day", text: "A light brace for desk days.", button: "Shop now", points: ["Fits under clothes", "Adjustable", "Light"] },
  trust: [
    { icon: "truck", text: "Delivery in 5–8 days" },
    { icon: "rocket", text: "Bad icon falls back" },
  ],
  benefits: { heading: "Why it helps", text: "Made for long days at a desk.", items: [{ icon: "leaf", title: "Breathable", text: "Soft mesh." }, { icon: "nope", title: "Clinically proven relief", text: "x" }] },
  steps: { heading: "How it works", items: [{ title: "Put it on", text: "Over or under your shirt." }] },
  story: { eyebrow: "Our pick", heading: "Why we sell it", paragraphs: ["We tried a dozen."], button: "About us" },
  faq: { heading: "Questions", items: [{ q: "How long is delivery?", a: "5–8 business days." }] },
  newsletter: { heading: "Stay in the loop", text: "New products, no spam." },
  footerText: "Posture gear that works.",
  productTrust: { shipping: "Delivery in 5–8 days", returns: "30-day returns", payment: "Secure checkout" },
  pages: {
    about: { title: "About us", paragraphs: ["We picked this brace because it works.", "Over 10,000 happy customers."] },
    shipping: { title: "Shipping & returns", paragraphs: ["Orders arrive in 5–8 business days."] },
    faq: { title: "FAQ" },
    contact: { title: "Contact", intro: "Write to us any time." },
  },
  menu: { home: "Home", shop: "Shop", about: "About", faq: "FAQ", contact: "Contact", shipping: "Shipping", search: "Search" },
};
const facts = { shippingTime: "5–8 business days", returnDays: 30, freeShippingFrom: 299, supportEmail: "help@store.dk", currency: "DKK" };

/** Reads a stored (uncompressed) zip back into { path: text }. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out: Record<string, string> = {};
  let at = 0;
  while (dv.getUint32(at, true) === 0x04034b50) {
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(crc32(data)).toBe(dv.getUint32(at + 14, true));
    out[name] = dec.decode(data);
    at += 30 + nameLen + size;
  }
  expect(dv.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  return out;
}

/** A section's {% schema %} from the bundled theme. */
function sectionSchema(type: string): { settings?: { id: string; type: string; options?: { value: string }[] }[]; blocks?: { type: string; settings?: { id: string; type: string; options?: { value: string }[] }[] }[] } {
  const src = THEME_FILES[`sections/${type}.liquid`];
  expect(src, `sections/${type}.liquid exists`).toBeTruthy();
  return JSON.parse(src.split("{% schema %}")[1].split("{% endschema %}")[0]);
}

function checkSettings(defs: { id: string; type: string; options?: { value: string }[] }[] | undefined, values: Record<string, unknown>, where: string) {
  for (const [id, value] of Object.entries(values)) {
    const def = defs?.find((d) => d.id === id);
    expect(def, `${where}: setting "${id}" exists`).toBeTruthy();
    if (def?.options) expect(def.options.map((o) => o.value), `${where}: "${id}" = ${String(value)}`).toContain(value);
  }
}

/** Every section and block of a JSON template exists in the theme, with settings its schema has. */
function checkTemplate(tpl: { order: string[]; sections: Record<string, unknown> }, where: string) {
  type Section = { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings: Record<string, unknown> }>; block_order?: string[] };
  for (const key of tpl.order) {
    const sec = tpl.sections[key] as Section;
    const schema = sectionSchema(sec.type);
    checkSettings(schema.settings, sec.settings ?? {}, `${where} ${key}`);
    for (const blockKey of sec.block_order ?? []) {
      const block = sec.blocks![blockKey];
      const def = schema.blocks?.find((b) => b.type === block.type);
      expect(def, `${key} block type ${block.type}`).toBeTruthy();
      checkSettings(def?.settings, block.settings, `${key}.${blockKey}`);
    }
  }
}

const productPage = {
  ticks: ["Rank ryg – uden at tænke over det", "Blød polstring – til hele dagen", "Usynlig – under tøjet", "Justerbar – passer de fleste"],
  offer: "Spar op til 25 % når du køber flere",
  bundles: { heading: "Køb flere, spar mere", tiers: [{ title: "1 stk.", subtitle: "Prøv den" }, { title: "2 stk.", subtitle: "Kun [unit] pr. stk." }, { title: "3 stk.", subtitle: "Kun 134 kr pr. stk." }], popular: "Mest populær", best: "Bedste pris" },
  sections: [
    { eyebrow: "Problemet", heading: "Ondt i nakken efter en lang dag?", text: "Mange sidder krumbøjede foran skærmen.", points: ["Ondt i nakken", "Træt ryg"] },
    { eyebrow: "Løsningen", heading: "Trækker skuldrene blidt tilbage", text: "Remmene minder dig om at sidde rankt.", points: ["Blid støtte"] },
    { eyebrow: "Detaljen", heading: "Kan vaskes i hånden", text: "Tag den af og skyl den.", points: [] },
  ],
  comparison: { heading: "Hvorfor vælge os", others: "Almindelig bandage", rows: [{ feature: "Justerbar", us: "YES", others: "partly" }, { feature: "Usynlig under tøj", us: "yes", others: "no" }, { feature: "Åndbar", us: "yes", others: "maybe" }] },
  tabs: [{ heading: "Materialer", text: "Neopren og nylon." }, { heading: "Brug", text: "Tag den på over en t-shirt." }],
  button: "Bestil nu",
  reviewsHeading: "Det siger kunderne",
};

describe("storefront theme", () => {
  it("is bundled from shopify-theme/ (run node scripts/build-theme.mjs after editing it)", () => {
    expect(THEME_FILES).toEqual(readTheme());
  });

  it("ships every style as a Theme settings preset", () => {
    const data = JSON.parse(THEME_FILES["config/settings_data.json"]);
    for (const id of STORE_STYLE_IDS) expect(data.presets[STORE_STYLES[id].name], id).toEqual(styleSettings(STORE_STYLES[id]));
    const ids = JSON.parse(THEME_FILES["config/settings_schema.json"]).flatMap((g: { settings?: { id: string }[] }) => (g.settings ?? []).map((s) => s.id));
    for (const key of Object.keys(STORE_STYLES.fresh.settings)) expect(ids).toContain(key);
  });

  it("keeps setting labels within Shopify's 70 characters (a longer one makes Shopify drop the section, and the templates using it)", () => {
    for (const [path, src] of Object.entries(THEME_FILES)) {
      if (!path.startsWith("sections/") || !src.includes("{% schema %}")) continue;
      const schema = sectionSchema(path.slice("sections/".length, -".liquid".length));
      const named = schema as { name?: string; blocks?: { name?: string }[] };
      for (const name of [named.name, ...(named.blocks ?? []).map((b) => b.name)]) if (name) expect(name.length, `${path}: "${name}"`).toBeLessThanOrEqual(25);
      for (const s of [...(schema.settings ?? []), ...(schema.blocks ?? []).flatMap((b) => b.settings ?? [])]) {
        const label = (s as { label?: string }).label ?? "";
        expect(label.length, `${path}: "${label}"`).toBeLessThanOrEqual(70);
      }
    }
  });

  it("has every translation key in every language", () => {
    const keys = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const en = keys(JSON.parse(THEME_FILES["locales/en.default.json"])).sort();
    for (const [path, text] of Object.entries(THEME_FILES)) if (path.startsWith("locales/")) expect(keys(JSON.parse(text)).sort(), path).toEqual(en);
    // Every 'key' | t in the theme exists in English.
    const used = new Set([...Object.values(THEME_FILES).join("\n").matchAll(/'([a-z_]+\.[a-z_]+)' \| t\b/g)].map((m) => m[1]));
    // Plural keys ({ one, other }) are used by their parent key.
    for (const k of used) expect(en.some((e) => e === k || e.startsWith(`${k}.`)), k).toBe(true);
  });

  it("writes a home page, header and footer the theme can render, in every style", () => {
    const clean = cleanStore(storeCopy);
    for (const style of STORE_STYLE_IDS) {
      const input: ThemeInput = { style, brandName: "Rank Ryg", productHandle: "posture-corrector", pageHandles: { about: "about-1" }, copy: clean, product: { title: "Posture corrector" }, facts };
      const files = themeOverrides(input);
      const settings = JSON.parse(files["config/settings_data.json"]);
      expect(settings.current).toMatchObject({ ...STORE_STYLES[style].settings, brand_name: "Rank Ryg", free_shipping_threshold: 299, delivery_min_days: 5, delivery_max_days: 8, show_add_another: true, guarantee_days: 30 });
      for (const group of ["templates/index.json", "templates/product.json", "sections/header-group.json", "sections/footer-group.json"]) checkTemplate(JSON.parse(files[group]), group);
      const index = JSON.parse(files["templates/index.json"]);
      expect(index.sections.hero.settings).toMatchObject({ product: "posture-corrector", heading: "Sit straighter, all day", layout: STORE_STYLES[style].heroLayout });
      expect(index.sections.story.settings.button_link).toBe("/pages/about-1");
      // The supplier reviews sit between the story and the FAQ, on another background than the story.
      expect(index.sections.reviews.settings.product).toBe("posture-corrector");
      expect(index.sections.reviews.settings.scheme).not.toBe(index.sections.story.settings.scheme);
      expect(index.order.slice(index.order.indexOf("story"), index.order.indexOf("story") + 3)).toEqual(["story", "reviews", "faq"]);
      expect(themeFiles(input)["layout/theme.liquid"]).toContain("content_for_header");
    }
  });

  it("builds the product page like the stores selling with ads, with bundle cards only when the discounts exist", () => {
    const pp = cleanProductPage(productPage)!;
    // Marks the theme doesn't know fall back to yes for us and no for others.
    expect(pp.comparison.rows.map((r) => [r.us, r.others])).toEqual([["yes", "partly"], ["yes", "no"], ["yes", "no"]]);
    const base: ThemeInput = { style: "fresh", brandName: "Rank Ryg", productHandle: "posture-corrector", copy: { ...cleanStore(storeCopy), productPage: pp }, product: { title: "Posture corrector" }, facts };

    expect(pp.bundles.tiers.map((x) => x.subtitle)).toEqual(["Prøv den", "Kun [unit] pr. stk.", ""]);
    const withDeals = productTemplate({ ...base, bundleOff: [...BUNDLE_OFF], aiPhotos: 2 });
    checkTemplate(withDeals, "product.json");
    const main = withDeals.sections.main as { blocks: Record<string, { type: string; settings: Record<string, unknown> }>; block_order: string[] };
    expect(main.block_order.slice(0, 5)).toEqual(["rating", "title", "subtitle", "price", "benefits"]);
    expect(main.block_order.indexOf("bundles")).toBe(main.block_order.indexOf("buy_buttons") - 1);
    expect(main.blocks.bundles.settings).toMatchObject({ tier1_qty: 1, tier2_qty: 2, tier3_qty: 3, tier1_off: 0, tier2_off: 15, tier3_off: 25, tier2_badge: "Mest populær", tier3_badge: "Bedste pris", tier2_subtitle: "Kun [unit] pr. stk." });
    expect(main.blocks.buy_buttons.settings.show_quantity).toBe(false);
    expect(main.blocks.urgency.settings.offer).toBe("Spar op til 25 % når du køber flere");
    expect(main.blocks.benefits.settings.lines).toBe(productPage.ticks.join("\n"));
    expect(main.block_order.filter((k) => main.blocks[k].type === "collapsible_tab")).toHaveLength(2);
    expect(withDeals.order).toEqual(["main", "problem", "comparison", "row2", "row3", "testimonials", "reviews", "guarantee", "faq"]);
    // The rows show the AI photos (2nd and 3rd photo), and the main photo without any.
    const photo = (tpl: ReturnType<typeof productTemplate>, key: string) => (tpl.sections[key] as { settings: { image_index: number } }).settings.image_index;
    expect(["problem", "row2", "row3"].map((k) => photo(withDeals, k))).toEqual([2, 3, 2]);

    // Without Launch's discounts the cards would show prices the checkout doesn't charge: none, and no offer line.
    const noDeals = productTemplate(base);
    const plain = noDeals.sections.main as typeof main;
    expect(plain.block_order).not.toContain("bundles");
    expect(photo(noDeals, "problem")).toBe(1);
    expect(plain.blocks.urgency.settings.offer).toBe("");
    expect(plain.blocks.buy_buttons.settings.show_quantity).toBe(true);
    // Without the product page copy: the theme's blocks with Launch's other copy, and no empty rows or table.
    const bare = productTemplate({ ...base, copy: cleanStore(storeCopy) });
    checkTemplate(bare, "product.json");
    expect(bare.order).toEqual(["main", "testimonials", "reviews", "guarantee", "faq"]);
    expect(cleanProductPage({})).toBeNull();
  });

  it("lowers bundle discounts that would sell below the margin, and says so", () => {
    const deals = [{ qty: 2, off: 50 }, { qty: 5, off: 60 }];
    // 179 kr, cost 60 kr: an item must sell for at least 85.71 kr, so up to 52% off.
    expect(capDeals(deals, 179, 60, "DKK")).toEqual({
      tiers: [{ qty: 2, off: 50 }, { qty: 5, off: 52 }],
      note: "Bundle discounts lowered to keep your margin (5 items −60% → −52%): at 179 DKK with a supplier cost of 60 DKK, every item keeps at least 30% margin up to 52% off.",
    });
    // Cost 80 kr: up to 36% off; both deals land there, so only the first stays, with the single item.
    expect(capDeals([{ qty: 1, off: 0 }, ...deals], 179, 80).tiers).toEqual([{ qty: 1, off: 0 }, { qty: 2, off: 36 }]);
    expect(capDeals(DEFAULT_TIERS, 179, 30).tiers).toEqual(DEFAULT_TIERS);
    expect(capDeals(DEFAULT_TIERS, 100, 72)).toMatchObject({ tiers: null, note: expect.stringContaining("No bundle deals") });
    expect(capDeals(DEFAULT_TIERS, 179, undefined)).toMatchObject({ tiers: DEFAULT_TIERS, note: expect.stringContaining("No supplier cost") });
  });

  it("lays the product page out like a mirrored page: its section order, deals and buy-box extras", () => {
    const pp = cleanProductPage(productPage)!;
    const base: ThemeInput = { style: "fresh", brandName: "Rank Ryg", productHandle: "posture-corrector", copy: { ...cleanStore(storeCopy), productPage: pp }, product: { title: "Posture corrector" }, facts };
    const mirror = mirrorPlan("https://komforttid.dk/products/a", null);
    const tpl = productTemplate({
      ...base,
      bundleOff: [10, 30],
      bundleQty: [2, 4],
      mirror: { ...mirror, tiers: [{ qty: 2, off: 10 }, { qty: 4, off: 30 }], preselect: 1, badges: [1], sections: ["row", "reviews", "row", "comparison", "faq"], sticky: false, delivery: false, guarantee: false },
    });
    checkTemplate(tpl, "product.json");
    expect(tpl.order).toEqual(["main", "problem", "testimonials", "reviews", "row2", "comparison", "faq"]);
    const main = tpl.sections.main as { settings: Record<string, unknown>; blocks: Record<string, { settings: Record<string, unknown> }>; block_order: string[] };
    expect(main.settings.sticky_bar).toBe(false);
    expect(main.block_order).not.toContain("guarantee");
    expect(main.block_order).not.toContain("delivery");
    expect(main.blocks.bundles.settings).toMatchObject({ preselect: "1", tier1_qty: 2, tier1_off: 10, tier1_badge: "Mest populær", tier2_qty: 4, tier2_off: 30, tier2_badge: "", tier3_qty: 0, tier3_badge: "" });
  });

  it("lays the home page out like a mirrored store, in its colors and fonts", () => {
    const timeline = cleanTimeline({
      heading: "What to expect",
      text: "Your first weeks.",
      button: "Shop now",
      items: [
        { label: "First use", title: "Feels supportive", text: "You notice your shoulders." },
        { label: "Week 2", title: "Part of your day", text: "Clinically proven to fix posture in 7 days. Wearing it becomes a habit." },
        { label: "", title: "", text: "dropped" },
      ],
    });
    expect(timeline?.items).toHaveLength(2);
    expect(timeline?.items[1].text).toBe("Wearing it becomes a habit."); // the unprovable claim is dropped
    const copy = { ...cleanStore(storeCopy), timeline };
    const mirror = {
      ...mirrorPlan("https://rival.com/", null),
      home: ["hero", "marquee", "reviews", "timeline", "benefits", "story", "faq", "guarantee"] as HomeSection[],
      look: { colors: { bg: "#ffffff", surface: "#f6fcf1", text: "#0b0b0b", accent: "#2c5801", accentText: "#ffffff" }, fonts: { head: "Poppins", body: "Poppins" } },
    };
    const files = themeOverrides({ style: "fresh", brandName: "Rank Ryg", productHandle: "posture-corrector", copy, product: { title: "Posture corrector" }, facts, mirror });
    const index = JSON.parse(files["templates/index.json"]);
    checkTemplate(index, "index.json");
    expect(index.order).toEqual(["hero", "marquee", "reviews", "timeline", "benefits", "story", "faq", "guarantee"]);
    expect(index.sections.timeline.settings).toMatchObject({ heading: "What to expect", button_label: "Shop now", product: "posture-corrector" });
    expect(index.sections.marquee.block_order.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(files["config/settings_data.json"]).current).toMatchObject({
      color_accent: "#2c5801",
      color_surface: "#f6fcf1",
      color_text: "#0b0b0b",
      custom_head_font: "Poppins",
      custom_body_font: "Poppins",
    });
    // Without its timeline copy the section is left out, not shown empty.
    const bare = JSON.parse(themeOverrides({ style: "fresh", brandName: "Rank Ryg", productHandle: "posture-corrector", copy: cleanStore(storeCopy), product: { title: "Posture corrector" }, facts, mirror })["templates/index.json"]);
    expect(bare.order).not.toContain("timeline");
  });

  it("keeps accent [brackets] only in the headings that turn them into italics", () => {
    const c = cleanStore({
      ...storeCopy,
      hero: { ...storeCopy.hero, heading: "Sit [straighter], all day" },
      benefits: { ...storeCopy.benefits, heading: "[Two] [pairs]", items: [{ icon: "leaf", title: "For dogs [and cats]", text: "Soft [mesh]." }] },
    });
    expect(c.hero.heading).toBe("Sit [straighter], all day");
    expect(c.benefits.heading).toBe("Two pairs");
    expect(c.benefits.items[0]).toMatchObject({ title: "For dogs and cats", text: "Soft mesh." });
  });

  it("drops claims it can't back up and icons the theme doesn't have", () => {
    const c = cleanStore(storeCopy);
    expect(c.trust).toEqual([{ icon: "truck", text: "Delivery in 5–8 days" }, { icon: "shield", text: "Bad icon falls back" }]);
    expect(c.benefits.items).toEqual([{ icon: "leaf", title: "Breathable", text: "Soft mesh." }]); // "Clinically proven" title emptied → dropped
    expect(c.pages.about.paragraphs).toEqual(["We picked this brace because it works."]); // "10,000 happy customers" dropped
  });

  it("builds pages and menus with our own menu handles", () => {
    const c = cleanStore(storeCopy);
    const pages = storePages(c, facts);
    expect(pages.contact).toMatchObject({ handle: "contact", templateSuffix: "contact" });
    expect(pages.contact.body).toContain("mailto:help@store.dk");
    expect(pages.faq.body).toContain("<h3>How long is delivery?</h3>");
    const menus = storeMenus(c, { productId: "gid://shopify/Product/1", pages: { about: "gid://shopify/Page/1", contact: "gid://shopify/Page/2" } }, "Posture corrector");
    expect(menus.main.map((m) => m.type)).toEqual(["FRONTPAGE", "CATALOG", "PRODUCT", "PAGE", "PAGE"]);
    expect(menus.footer.map((m) => m.title)).toEqual(["Contact", "Search"]);
    // The order tracking page, in the launch's language, first in the footer.
    expect(storePages(c, facts, "Danish").track).toMatchObject({ title: "Spor din ordre", handle: "track-order", templateSuffix: "track" });
    expect(pages.track.title).toBe("Track your order");
    const withTrack = storeMenus(c, { productId: "p", pages: { track: "gid://shopify/Page/3" } }, "x", "Spor din ordre");
    expect(withTrack.footer.map((m) => m.title)).toEqual(["Spor din ordre", "Search"]);
  });

  it("reads the delivery time for the cart's delivery dates", () => {
    expect(deliveryDays("5–10 business days")).toEqual({ min: 5, max: 10 });
    expect(deliveryDays("3-5 hverdage")).toEqual({ min: 3, max: 5 });
    expect(deliveryDays("1–2 uger")).toEqual({ min: 5, max: 10 });
    expect(deliveryDays("2 weeks")).toEqual({ min: 10, max: 10 });
    expect(deliveryDays("7 Tage")).toEqual({ min: 7, max: 7 });
    expect(deliveryDays("fast delivery")).toBeNull();
    expect(deliveryDays("365 days")).toBeNull();
  });

  it("keeps the product's menu label short", () => {
    expect(menuLabel("SteamPet Pro Comb – 4-i-1 dampbørste til kæledyr")).toBe("SteamPet Pro Comb");
    expect(menuLabel("Pibende hundelegetøj i latex – sæt med 4")).toBe("Pibende hundelegetøj i latex");
    expect(menuLabel("Squeaky Dog Toys Set of 4 - Fun and Durable Latex Chew Toys for Dogs")).toBe("Squeaky Dog Toys Set of 4");
    expect(menuLabel("MAGCUBIC Mini Hjemmeprojektor med indbygget højttaler og fjernbetjening")).toBe("MAGCUBIC Mini Hjemmeprojektor");
    expect(menuLabel("Posture corrector")).toBe("Posture corrector");
  });

  it("zips files Shopify can unpack", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const files = { "layout/theme.liquid": "<html>{{ content_for_layout }}</html>", "locales/da.json": '{"a":"Læg i kurv"}' };
    expect(unzip(zipFiles(files))).toEqual(files);
  });
});

describe("Launch → Full store", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("SHOPIFY_TOKEN_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
    vi.stubEnv("CONVEX_SITE_URL", "https://x.convex.site");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const product = {
    title: "posture corrector", description: "", imageUrl: "https://cdn.x/p.jpg", price: 30, cost: 4.2, category: "Health & Wellness", tags: [], aiScore: 88,
    saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
  };
  const productCopy = {
    title: "Rank Ryg Holdningskorrektor", subtitle: "Sid ret hele dagen", benefits: ["Trækker skuldrene tilbage"], hook: "Øm ryg efter skrivebordet?",
    howItWorks: ["Tag den på"], whatsIncluded: ["1 bøjle"], faq: [{ q: "Størrelse?", a: "Én størrelse." }], shippingReturns: "Levering 5–8 dage.",
    seo: { title: "Holdningskorrektor", description: "Justerbar." }, adKit: [], checks: [],
  };

  async function setup(conn: Record<string, unknown> = {}) {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
      await ctx.db.insert("shopifyConnections", {
        userId, shopDomain: "rank.myshopify.com", shopName: "Rank Ryg", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", currency: "DKK", locale: "da", ...conn,
      });
      await ctx.db.insert("siteStats", { key: "fxRates", data: { rates: { USD: 1, EUR: 0.86, GBP: 0.74, DKK: 6.4 }, all: { DKK: 6.4, EUR: 0.86 }, date: "2026-10-08" }, updatedAt: "" });
      return ctx.db.insert("products", product);
    });
    return { t, productId, user: t.withIdentity({ subject: "u1|s" }) };
  }

  it("prices in the store's currency", async () => {
    const { user, productId } = await setup();
    expect((await user.query(api.launch.prepare, { productId }))?.suggested).toEqual({ price: 79, cost: 26.88, marginPercent: 66 });
  });

  it("reads the currency of stores connected with a token, and a new token keeps the store's pages", async () => {
    const { t, user, productId } = await setup({ currency: undefined, locale: undefined, storePages: { about: "gid://shopify/Page/1" } });
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      const q: string = JSON.parse(String(init?.body)).query;
      if (q.includes("shopLocales")) return json({ errors: [{ message: "Access denied for shopLocales field. Required access: `read_locales`" }] });
      return json({ data: { shop: { name: "Rank Ryg", myshopifyDomain: "rank.myshopify.com", currencyCode: "DKK" } } });
    }));
    expect((await user.query(api.launch.prepare, { productId }))?.store).toMatchObject({ currency: "USD", currencyKnown: false, viaApp: false });
    await user.action(api.shopifyImport.refreshStoreInfo, {});
    expect((await user.query(api.launch.prepare, { productId }))?.store).toMatchObject({ currency: "DKK", currencyKnown: true });

    await user.action(api.shopifyImport.connect, { shopDomain: "rank.myshopify.com", accessToken: `shpat_${"a".repeat(32)}` });
    const conn = await t.run(async (ctx) => (await ctx.db.query("shopifyConnections").collect())[0]);
    expect(conn).toMatchObject({ currency: "DKK", accessToken: `shpat_${"a".repeat(32)}`, storePages: { about: "gid://shopify/Page/1" } });
  });

  it("adds the supplier's reviews, translated, for the theme's reviews section", async () => {
    let productSet: { metafields: { key: string; value: string }[] } | undefined;
    let feedbackUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const msg = (text: string) => json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } });
        if (String(body.messages[0].content).includes("Translate these customer reviews into Danish")) return msg('["Min hund elsker den, og det gør hundene jeg træner også."]');
        return msg(JSON.stringify(String(body.system).includes("rest of a one-product dropshipping store") ? storeCopy : productCopy));
      }
      if (url.includes("feedback.aliexpress.com")) {
        feedbackUrl = url;
        return json({ data: { productEvaluationStatistic: { evarageStar: 4.7, totalNum: 42, fiveStarNum: 40, fourStarNum: 2 }, evaViewList: [
          { anonymous: true, buyerName: "AliExpress Shopper", buyerCountry: "BR", buyerEval: 100, buyerTranslationFeedback: "My dogs love it, and so do the dogs I train.", evalDate: "28 Jul 2026", images: [] },
          { anonymous: false, buyerName: "k***a", buyerCountry: "PL", buyerEval: 100, buyerTranslationFeedback: "Fast shipping, arrived in 10 days", evalDate: "1 Aug 2026", images: [] },
        ] } });
      }
      const q = JSON.parse(String(init?.body)).variables?.input;
      if (q?.metafields) productSet = q;
      return json({ errors: [{ message: "stop here" }] }); // Shopify: only the product input matters here
    }));
    const { t, productId, user } = await setup();
    const { launchId } = await user.mutation(api.launch.start, {
      productId, language: "Danish", tone: "friendly", publish: "DRAFT", mode: "store", style: "nordic", facts: { shippingTime: "5–8 dage", returnDays: 30 },
      reviewsUrl: "https://www.aliexpress.com/item/1005012299631792.html?spm=x",
    });
    await settle(t);
    expect(feedbackUrl).toContain("productId=1005012299631792");
    const reviews = JSON.parse(productSet!.metafields.find((m) => m.key === "reviews")!.value);
    expect(reviews).toEqual({
      source: "aliexpress", average: 4.7, total: 42, stars: [40, 2, 0, 0, 0], listings: 1,
      items: [{ name: "", country: "BR", rating: 5, text: "Min hund elsker den, og det gør hundene jeg træner også.", date: "28 Jul 2026", images: [] }],
    });
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({
      reviews: { total: 42 },
      reviewsNote: "Only 1 written review worth showing on that AliExpress listing. Add another AliExpress link for the same product to show more.",
    });
  });

  it("still writes the store when the API won't compile its schema", async () => {
    let storeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const msg = (text: string) => json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } });
        if (!String(body.system).includes("rest of a one-product dropshipping store")) return msg(JSON.stringify(productCopy));
        if (String(body.messages[0].content).includes("product page's extra copy")) return msg(JSON.stringify(productPage));
        storeCalls++;
        if (body.output_config?.format) {
          return json({ type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large, which would cause performance issues." } }, 400);
        }
        return msg(`Here you go:\n${JSON.stringify({ ...storeCopy, trust: [storeCopy.trust[0]] })}`);
      }
      return json({ errors: [{ message: "stop here" }] }); // Shopify: not needed for this test
    }));
    const { t, productId, user } = await setup();
    const { launchId } = await user.mutation(api.launch.start, {
      productId, language: "Danish", tone: "friendly", publish: "DRAFT", mode: "store", style: "playful", facts: { shippingTime: "5–8 dage", returnDays: 30 },
      // "Match a screenshot": checked again on the way in (an unknown font drops out).
      look: { accent: "#E4572E", roundness: "round", headingFont: "Wingdings", changed: ["anything"] },
    });
    await settle(t);
    const l = await user.query(api.launch.get, { launchId });
    expect(storeCalls).toBe(2);
    expect(l?.look).toEqual({ accent: "#e4572e", roundness: "round", changed: ["Accent color #e4572e", "Shapes: round"] });
    expect(l?.design).toEqual(l?.look); // no special requests: the store takes the screenshot's look
    expect(l?.store).toMatchObject({ hero: { heading: "Sit straighter, all day" }, trust: [{ icon: "truck" }] });
    expect(l?.error).toContain("stop here"); // got past the AI step
  });

  it("updates the product an earlier launch made, and works around a taken handle", async () => {
    const inputs: Record<string, unknown>[] = [];
    let taken = true;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(productCopy) }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      const input = JSON.parse(String(init?.body)).variables.input;
      inputs.push(input);
      if (input.id === "gid://shopify/Product/1") return json({ data: { productSet: { product: { id: input.id, handle: "x" }, userErrors: [] } } });
      if (taken && !String(input.handle).match(/-[a-z0-9]{4}$/)) {
        return json({ data: { productSet: { product: null, userErrors: [{ field: ["input", "handle"], message: `Handle '${input.handle}' already in use. Please provide a new handle.` }] } } });
      }
      return json({ data: { productSet: { product: { id: "gid://shopify/Product/2", handle: input.handle }, userErrors: [] } } });
    }));
    const { t, productId, user } = await setup();
    const first = await user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "DRAFT" });
    await settle(t);
    expect(await user.query(api.launch.get, { launchId: first.launchId })).toMatchObject({ status: "published", shopifyProductId: "gid://shopify/Product/2" });
    expect(inputs.map((i) => i.handle)).toEqual(["rank-ryg-holdningskorrektor", expect.stringMatching(/^rank-ryg-holdningskorrektor-[a-z0-9]{4}$/)]);

    // Launching it again updates that product instead of creating another.
    await t.run((ctx) => ctx.db.patch("launches", first.launchId, { shopifyProductId: "gid://shopify/Product/1" }));
    inputs.length = 0;
    taken = false;
    const again = await user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "DRAFT" });
    await settle(t);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ id: "gid://shopify/Product/1" });
    // The product keeps its address: ads may already link to it.
    expect(inputs[0]).not.toHaveProperty("handle");
    expect(await user.query(api.launch.get, { launchId: again.launchId })).toMatchObject({ status: "published", shopifyProductId: "gid://shopify/Product/1" });
  });

  it("asks app installs from before Full store to reconnect", async () => {
    const { user, productId } = await setup({ via: "oauth", scopes: "write_products,write_publications" });
    expect((await user.query(api.launch.prepare, { productId }))?.store?.missingStoreScopes).toHaveLength(3);
    await expect(
      user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", facts: { shippingTime: "5–8 dage", returnDays: 30 } }),
    ).rejects.toThrow(/Reconnect your Shopify store/);
  });

  it("makes room for the theme when the store has Shopify's 20, by removing the replaced launch's theme", async () => {
    const calls: string[] = [];
    let full = true;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const isPage = String(body.messages[0].content).includes("product page's extra copy");
        const isStore = !isPage && String(body.system).includes("rest of a one-product dropshipping store");
        return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(isPage ? productPage : isStore ? { ...storeCopy, trust: [storeCopy.trust[0]] } : productCopy) }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      const body = JSON.parse(String(init?.body));
      const q: string = body.query;
      calls.push(q.includes("themeDelete") ? `themeDelete ${body.variables.id}` : q.slice(0, 30));
      if (q.includes("productSet")) return json({ data: { productSet: { product: { id: "gid://shopify/Product/9", handle: "rank-ryg" }, userErrors: [] } } });
      if (q.includes("pageCreate")) return json({ data: { pageCreate: { page: { id: `gid://shopify/Page/${body.variables.page.handle}`, handle: body.variables.page.handle }, userErrors: [] } } });
      if (q.includes("menus(")) return json({ data: { menus: { nodes: [] } } });
      if (q.includes("pageUpdate")) return json({ data: { pageUpdate: { page: { id: body.variables.id, handle: "p" }, userErrors: [] } } });
      if (q.includes("discountAutomaticDelete")) return json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: body.variables.id, userErrors: [] } } });
      if (q.includes("menuCreate")) return json({ data: { menuCreate: { menu: { id: "gid://shopify/Menu/6" }, userErrors: [] } } });
      if (q.includes("discountAutomaticBasicCreate")) return json({ data: { discountAutomaticBasicCreate: { automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/1" }, userErrors: [] } } });
      if (q.includes("themeCreate")) {
        return full
          ? json({ data: { themeCreate: { theme: null, userErrors: [{ field: ["source"], message: "A shop may only have 20 themes" }] } } })
          : json({ data: { themeCreate: { theme: { id: "gid://shopify/OnlineStoreTheme/78", processing: false }, userErrors: [] } } });
      }
      if (q.includes("theme(id")) {
        if (body.variables.id === "gid://shopify/OnlineStoreTheme/70") return json({ data: { theme: { id: body.variables.id, role: "UNPUBLISHED" } } });
        return json({ data: { theme: { id: body.variables.id, processing: false, processingFailed: false } } });
      }
      if (q.includes("themeDelete")) {
        full = false;
        return json({ data: { themeDelete: { deletedThemeId: body.variables.id, userErrors: [] } } });
      }
      return json({ errors: [{ message: `unexpected ${q.slice(0, 40)}` }] });
    }));
    const { t, productId, user } = await setup();
    const facts = { shippingTime: "5–8 hverdage", returnDays: 30 };
    // Without a launch to replace: a clear way out.
    const first = await user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "DRAFT", mode: "store", style: "nordic", brandName: "Rank Ryg", facts });
    await settle(t);
    expect((await user.query(api.launch.get, { launchId: first.launchId }))?.error).toContain("maximum of 20 themes");

    // A relaunch that replaces a launch: its theme goes first, then the new one installs.
    await t.run((ctx) => ctx.db.patch("launches", first.launchId, { status: "published", themeId: "gid://shopify/OnlineStoreTheme/70" }));
    const again = await user.mutation(api.launch.relaunch, { launchId: first.launchId, replaceOld: true });
    await settle(t);
    expect(await user.query(api.launch.get, { launchId: again.launchId })).toMatchObject({ status: "published", themeId: "gid://shopify/OnlineStoreTheme/78" });
    expect(calls).toContain("themeDelete gid://shopify/OnlineStoreTheme/70");
    expect(await t.run((ctx) => ctx.db.get("launches", first.launchId))).toBeNull();
  });

  it("writes the store, creates the product, pages and menus, and installs the theme unpublished", async () => {
    // Structured output only returns icons from the list.
    const validStore = { ...storeCopy, trust: [storeCopy.trust[0]], benefits: { ...storeCopy.benefits, items: [storeCopy.benefits.items[0]] } };
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    let prompt = "";
    const aiBodies: { system: string; output_config: { format: { schema: unknown } } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        aiBodies.push(body);
        const isPage = String(body.messages[0].content).includes("product page's extra copy");
        const isStore = !isPage && String(body.system).includes("rest of a one-product dropshipping store");
        if (isStore) prompt = String(init?.body ?? "");
        return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(isPage ? productPage : isStore ? validStore : productCopy) }], usage: { input_tokens: 10, output_tokens: 10 } });
      }
      if (!url.includes("/graphql.json")) return new Response("", { status: 404 });
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const q: string = body.query;
      if (q.includes("productSet")) return json({ data: { productSet: { product: { id: "gid://shopify/Product/9", handle: "rank-ryg", onlineStorePreviewUrl: null }, userErrors: [] } } });
      if (q.includes("publications(")) return json({ data: { publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store" }] } } });
      if (q.includes("publishablePublish")) return json({ data: { publishablePublish: { userErrors: [] } } });
      if (q.includes("pageCreate")) {
        const handle = body.variables.page.handle === "contact" ? "contact-1" : body.variables.page.handle; // Shopify renames taken handles
        return json({ data: { pageCreate: { page: { id: `gid://shopify/Page/${handle}`, handle }, userErrors: [] } } });
      }
      if (q.includes("menus(")) return json({ data: { menus: { nodes: [{ id: "gid://shopify/Menu/5", handle: "adspy-footer" }] } } });
      if (q.includes("menuCreate")) return json({ data: { menuCreate: { menu: { id: "gid://shopify/Menu/6" }, userErrors: [] } } });
      if (q.includes("menuUpdate")) return json({ data: { menuUpdate: { menu: { id: "gid://shopify/Menu/5" }, userErrors: [] } } });
      if (q.includes("themeCreate")) return json({ data: { themeCreate: { theme: { id: "gid://shopify/OnlineStoreTheme/77", processing: true }, userErrors: [] } } });
      if (q.includes("theme(id")) return json({ data: { theme: { id: "gid://shopify/OnlineStoreTheme/77", processing: false, processingFailed: false } } });
      if (q.includes("themePublish")) return json({ data: { themePublish: { theme: { id: "gid://shopify/OnlineStoreTheme/77", role: "MAIN" }, userErrors: [] } } });
      if (q.includes("discountAutomaticDelete")) return json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: body.variables.id, userErrors: [] } } });
      if (q.includes("discountAutomaticBasicCreate")) {
        const n = calls.filter((c) => c.query.includes("discountAutomaticBasicCreate")).length;
        return json({ data: { discountAutomaticBasicCreate: { automaticDiscountNode: { id: `gid://shopify/DiscountAutomaticNode/${10 + n}` }, userErrors: [] } } });
      }
      return json({ errors: [{ message: `unexpected ${q.slice(0, 40)}` }] });
    }));

    const { t, productId, user } = await setup();
    // An earlier launch of the product in another store, and one in this store with its bundle discounts.
    await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      const base = { userId, productId, language: "Danish", tone: "friendly", publish: "DRAFT", status: "published", createdAt: "2026-10-01" };
      await ctx.db.insert("launches", { ...base, shopDomain: "other.myshopify.com", bundleDiscountIds: ["gid://shopify/DiscountAutomaticNode/7"] });
      await ctx.db.insert("launches", { ...base, shopDomain: "rank.myshopify.com", bundleDiscountIds: ["gid://shopify/DiscountAutomaticNode/1"] });
    });
    const { launchId } = await user.mutation(api.launch.start, {
      productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", brandName: "Rank Ryg",
      facts: { shippingTime: "5–8 hverdage", returnDays: 30, freeShippingFrom: 299, supportEmail: "hej@rankryg.dk" },
    });
    await settle(t);
    const l = await user.query(api.launch.get, { launchId });
    expect(l).toMatchObject({
      status: "published", mode: "store", style: "nordic", price: 79, productHandle: "rank-ryg",
      themeId: "gid://shopify/OnlineStoreTheme/77", themePreviewUrl: "https://rank.myshopify.com/?preview_theme_id=77",
      themeEditorUrl: "https://rank.myshopify.com/admin/themes/77/editor", pageHandles: { about: "about", contact: "contact-1" },
    });
    expect(prompt).toContain("Returns: within 30 days of delivery");
    // Small strict schemas without enums: one big one was rejected ("compiled grammar is too large").
    expect(aiBodies).toHaveLength(3);
    for (const b of aiBodies) expect(JSON.stringify(b.output_config.format.schema)).not.toContain('"enum"');
    expect(prompt).toContain("Free shipping on orders from 299 DKK");

    const productSet = calls.find((c) => c.query.includes("productSet"))!.variables.input as { descriptionHtml: string; variants: { price: string; inventoryItem: { cost: string } }[] };
    expect(productSet.variants[0]).toMatchObject({ price: "79.00", inventoryItem: { cost: "26.88" } });
    expect(productSet.descriptionHtml).toContain("<h3>Sådan virker det</h3>"); // Danish headings
    expect(productSet.descriptionHtml).not.toContain("Trækker skuldrene"); // the theme shows benefits itself
    expect(calls.filter((c) => c.query.includes("pageCreate"))).toHaveLength(5);
    expect(calls.find((c) => c.query.includes("menuCreate"))?.variables).toMatchObject({ handle: "adspy-main" });
    expect(calls.find((c) => c.query.includes("menuUpdate"))?.variables).toMatchObject({ id: "gid://shopify/Menu/5", handle: "adspy-footer" });
    const conn = await t.run(async (ctx) => (await ctx.db.query("shopifyConnections").collect())[0]);
    expect(conn.storePages).toMatchObject({ about: "gid://shopify/Page/about", contact: "gid://shopify/Page/contact-1" });

    // Shopify downloads the theme from the signed link; a wrong signature gets nothing.
    const source = new URL(String(calls.find((c) => c.query.includes("themeCreate"))!.variables.source));
    expect(source.origin).toBe("https://x.convex.site");
    expect((await t.fetch(`${source.pathname}?l=${source.searchParams.get("l")}&s=bad`)).status).toBe(404);
    const res = await t.fetch(`${source.pathname}${source.search}`);
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).length).toBe(Object.keys(THEME_FILES).length);
    expect(JSON.parse(files["config/settings_data.json"]).current).toMatchObject({ color_accent: STORE_STYLES.nordic.settings.color_accent, brand_name: "Rank Ryg" });
    expect(JSON.parse(files["templates/index.json"]).sections.hero.settings.product).toBe("rank-ryg");

    // Bundle deals: this store's earlier discounts replaced (not another store's), one discount per deal named for
    // shoppers, and the cards on the page.
    expect(calls.filter((c) => c.query.includes("discountAutomaticDelete")).map((c) => c.variables.id)).toEqual(["gid://shopify/DiscountAutomaticNode/1"]);
    const deals = calls.filter((c) => c.query.includes("discountAutomaticBasicCreate")).map((c) => c.variables.d as { title: string; customerGets: unknown; minimumRequirement: unknown });
    expect(deals).toMatchObject([
      { title: "Køb flere, spar mere · 2 stk.", customerGets: { value: { percentage: 0.15 }, items: { products: { productsToAdd: ["gid://shopify/Product/9"] } } }, minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "2" } } },
      { title: "Køb flere, spar mere · 3 stk.", customerGets: { value: { percentage: 0.25 } }, minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "3" } } },
    ]);
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({ bundleOff: [0, 15, 25], bundleDiscountIds: ["gid://shopify/DiscountAutomaticNode/11", "gid://shopify/DiscountAutomaticNode/12"] });
    const productTpl = JSON.parse(files["templates/product.json"]);
    expect(productTpl.sections.main.blocks.bundles.settings).toMatchObject({ tier2_off: 15, tier3_off: 25, tier2_badge: "Mest populær" });
    expect(productTpl.sections.comparison.settings).toMatchObject({ us_label: "Rank Ryg", them_1: "Almindelig bandage" });

    // A launch built on Dawn gets Dawn from the same link, with the same copy and style.
    await t.run((ctx) => ctx.db.patch("launches", launchId, { baseTheme: "dawn" }));
    const dawn = unzip(new Uint8Array(await (await t.fetch(`${source.pathname}${source.search}`)).arrayBuffer()));
    expect(dawn["snippets/dawn-license.liquid"]).toContain("Shopify Inc.");
    expect(dawn["sections/adspy-reviews.liquid"]).toBeTruthy();
    expect(JSON.parse(dawn["templates/index.json"]).sections.product.settings.product).toBe("rank-ryg");
    expect(JSON.parse(dawn["config/settings_data.json"]).current.color_schemes["scheme-1"].settings.button).toBe(STORE_STYLES.nordic.settings.color_accent);
    await t.run((ctx) => ctx.db.patch("launches", launchId, { baseTheme: undefined }));

    // Going live is the user's call.
    expect(calls.some((c) => c.query.includes("themePublish"))).toBe(false);
    await user.mutation(api.launch.publishTheme, { launchId });
    await settle(t);
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({ themeLive: true });
  });

  it("copies a competitor page's layout: its deals become the discounts and cards, its sections set the order", async () => {
    const validStore = { ...storeCopy, trust: [storeCopy.trust[0]], benefits: { ...storeCopy.benefits, items: [storeCopy.benefits.items[0]] } };
    const deals = { blockTitle: "Bundle", preselectedDealBarId: "b", dealBars: [
      { id: "a", quantity: 1, discountType: "percentage", discountValue: 0 },
      { id: "b", quantity: 2, discountType: "percentage", discountValue: 20 },
      { id: "c", quantity: 4, discountType: "percentage", discountValue: 35 },
    ] };
    const rival =
      '<html><script>Shopify.shop = "rival.myshopify.com";</script>' +
      '<div id="shopify-section-template--9__main">Buy now. Estimated delivery: Oct 20. Only today! Ends at midnight.' +
      `<script type="application/json" class="kaching-bundles-deal-block-settings">${JSON.stringify(deals)}</script></div>` +
      '<section id="shopify-section-template--9__faq_abc123"><h2>FAQ</h2></section>' +
      '<section id="shopify-section-template--9__image_with_text_x"></section>' +
      '<section id="shopify-section-template--9__comparison_y"></section></html>';
    let pageBrief = "";
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url === "https://rival.dk/products/a") return new Response(rival, { status: 200 });
      if (url === "https://rival.dk/products/a.js") return json({ id: 5, title: "Rival", variants: [{ price: 10000, available: true }] });
      if (url.includes("anthropic.com")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const isPage = String(body.messages[0].content).includes("product page's extra copy");
        const isStore = !isPage && String(body.system).includes("rest of a one-product dropshipping store");
        if (isPage) pageBrief = String(body.messages[0].content);
        return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(isPage ? productPage : isStore ? validStore : productCopy) }], usage: { input_tokens: 10, output_tokens: 10 } });
      }
      if (!url.includes("/graphql.json")) return new Response("", { status: 404 });
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const q: string = body.query;
      if (q.includes("productSet")) return json({ data: { productSet: { product: { id: "gid://shopify/Product/9", handle: "rank-ryg", onlineStorePreviewUrl: null }, userErrors: [] } } });
      if (q.includes("publications(")) return json({ data: { publications: { nodes: [] } } });
      if (q.includes("pageCreate")) return json({ data: { pageCreate: { page: { id: `gid://shopify/Page/${body.variables.page.handle}`, handle: body.variables.page.handle }, userErrors: [] } } });
      if (q.includes("menus(")) return json({ data: { menus: { nodes: [] } } });
      if (q.includes("menuCreate")) return json({ data: { menuCreate: { menu: { id: "gid://shopify/Menu/6" }, userErrors: [] } } });
      if (q.includes("themeCreate")) return json({ data: { themeCreate: { theme: { id: "gid://shopify/OnlineStoreTheme/77", processing: false }, userErrors: [] } } });
      if (q.includes("theme(id")) return json({ data: { theme: { id: "gid://shopify/OnlineStoreTheme/77", processing: false, processingFailed: false } } });
      if (q.includes("discountAutomaticBasicCreate")) {
        // Another product's deal already has the 2-item title.
        if (body.variables.d.title === "Køb flere, spar mere · 2 stk.") return json({ data: { discountAutomaticBasicCreate: { automaticDiscountNode: null, userErrors: [{ field: ["title"], message: "Title must be unique for automatic discount." }] } } });
        return json({ data: { discountAutomaticBasicCreate: { automaticDiscountNode: { id: `gid://shopify/DiscountAutomaticNode/${calls.length}` }, userErrors: [] } } });
      }
      return json({ errors: [{ message: `unexpected ${q.slice(0, 40)}` }] });
    }));

    const { t, productId, user } = await setup();
    await expect(user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", mirrorUrl: "not a link" })).rejects.toThrow(/full link/);
    const { launchId } = await user.mutation(api.launch.start, {
      productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", brandName: "Rank Ryg", mirrorUrl: "rival.dk/products/a",
      facts: { shippingTime: "5–8 hverdage", returnDays: 30 },
    });
    await settle(t);
    const l = await user.query(api.launch.get, { launchId });
    expect(l).toMatchObject({ status: "published", mirrorUrl: "https://rival.dk/products/a", bundleOff: [0, 20, 35], bundleQty: [1, 2, 4] });
    expect(l?.mirror).toMatchObject({ host: "rival.dk", preselect: 2, sections: ["faq", "row", "comparison", "reviews"], delivery: true, sticky: false, guarantee: false });
    expect((l?.mirror as { skipped: string[] }).skipped.join("\n")).toMatch(/Countdown timer/);
    expect(pageBrief).toContain("tiers: exactly 3, for 1, 2 and 4 items, which cost 0%, 20%, 35% less");
    const made = calls.filter((c) => c.query.includes("discountAutomaticBasicCreate")).map((c) => c.variables.d as { title: string; minimumRequirement: unknown; customerGets: { value: unknown } });
    // A taken title gets the product's name.
    expect(made.map((d) => d.title)).toEqual(["Køb flere, spar mere · 2 stk.", `Køb flere, spar mere · 2 stk. – ${productCopy.title.slice(0, 40)}`, "Køb flere, spar mere · 3 stk."]);
    expect(made.slice(1)).toMatchObject([
      { customerGets: { value: { percentage: 0.2 } }, minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "2" } } },
      { customerGets: { value: { percentage: 0.35 } }, minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "4" } } },
    ]);
    expect(l?.bundlesNote).toBeUndefined();

    const source = new URL(String(calls.find((c) => c.query.includes("themeCreate"))!.variables.source));
    const files = unzip(new Uint8Array(await (await t.fetch(`${source.pathname}${source.search}`)).arrayBuffer()));
    const tpl = JSON.parse(files["templates/product.json"]);
    expect(tpl.order).toEqual(["main", "faq", "problem", "comparison", "testimonials", "reviews"]);
    expect(tpl.sections.main.settings.sticky_bar).toBe(false);
    expect(tpl.sections.main.blocks.bundles.settings).toMatchObject({ preselect: "2", tier3_qty: 4, tier3_off: 35 });
  });
});
