/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { THEME_FILES } from "./lib/themeFiles.generated";
import { cleanStore, storeMenus, storePages, themeFiles, themeOverrides, type StoreCopy, type ThemeInput } from "./lib/storeKit";
import { STORE_STYLES, STORE_STYLE_IDS } from "./lib/storeStyles";
import { crc32, zipFiles } from "./lib/zip";
import { readTheme } from "../scripts/build-theme.mjs";

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

describe("storefront theme", () => {
  it("is bundled from shopify-theme/ (run node scripts/build-theme.mjs after editing it)", () => {
    expect(THEME_FILES).toEqual(readTheme());
  });

  it("ships every style as a Theme settings preset", () => {
    const data = JSON.parse(THEME_FILES["config/settings_data.json"]);
    for (const id of STORE_STYLE_IDS) expect(data.presets[STORE_STYLES[id].name]).toEqual(STORE_STYLES[id].settings);
    const ids = JSON.parse(THEME_FILES["config/settings_schema.json"]).flatMap((g: { settings?: { id: string }[] }) => (g.settings ?? []).map((s) => s.id));
    for (const key of Object.keys(STORE_STYLES.fresh.settings)) expect(ids).toContain(key);
  });

  it("has every translation key in every language", () => {
    const keys = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const en = keys(JSON.parse(THEME_FILES["locales/en.default.json"])).sort();
    for (const [path, text] of Object.entries(THEME_FILES)) if (path.startsWith("locales/")) expect(keys(JSON.parse(text)).sort(), path).toEqual(en);
    // Every 'key' | t in the theme exists in English.
    const used = new Set([...Object.values(THEME_FILES).join("\n").matchAll(/'([a-z_]+\.[a-z_]+)' \| t\b/g)].map((m) => m[1]));
    for (const k of used) expect(en, k).toContain(k);
  });

  it("writes a home page, header and footer the theme can render, in every style", () => {
    const clean = cleanStore(storeCopy);
    for (const style of STORE_STYLE_IDS) {
      const input: ThemeInput = { style, brandName: "Rank Ryg", productHandle: "posture-corrector", pageHandles: { about: "about-1" }, copy: clean, product: { title: "Posture corrector" }, facts };
      const files = themeOverrides(input);
      const settings = JSON.parse(files["config/settings_data.json"]);
      expect(settings.current).toMatchObject({ ...STORE_STYLES[style].settings, brand_name: "Rank Ryg", free_shipping_threshold: 299 });
      for (const group of ["templates/index.json", "sections/header-group.json", "sections/footer-group.json"]) {
        const tpl = JSON.parse(files[group]);
        for (const key of tpl.order) {
          const sec = tpl.sections[key];
          const schema = sectionSchema(sec.type);
          checkSettings(schema.settings, sec.settings ?? {}, `${group} ${key}`);
          for (const blockKey of sec.block_order ?? []) {
            const block = sec.blocks[blockKey];
            const def = schema.blocks?.find((b) => b.type === block.type);
            expect(def, `${key} block type ${block.type}`).toBeTruthy();
            checkSettings(def?.settings, block.settings, `${key}.${blockKey}`);
          }
        }
      }
      const index = JSON.parse(files["templates/index.json"]);
      expect(index.sections.hero.settings).toMatchObject({ product: "posture-corrector", heading: "Sit straighter, all day", layout: STORE_STYLES[style].heroLayout });
      expect(index.sections.story.settings.button_link).toBe("/pages/about-1");
      expect(themeFiles(input)["layout/theme.liquid"]).toContain("content_for_header");
    }
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
    seo: { title: "Holdningskorrektor", description: "Justerbar." }, adKit: [],
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

  it("asks app installs from before Full store to reconnect", async () => {
    const { user, productId } = await setup({ via: "oauth", scopes: "write_products,write_publications" });
    expect((await user.query(api.launch.prepare, { productId }))?.store?.missingStoreScopes).toHaveLength(3);
    await expect(
      user.mutation(api.launch.start, { productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", facts: { shippingTime: "5–8 dage", returnDays: 30 } }),
    ).rejects.toThrow(/Reconnect your Shopify store/);
  });

  it("writes the store, creates the product, pages and menus, and installs the theme unpublished", async () => {
    // Structured output only returns icons from the list.
    const validStore = { ...storeCopy, trust: [storeCopy.trust[0]], benefits: { ...storeCopy.benefits, items: [storeCopy.benefits.items[0]] } };
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        prompt = String(init?.body ?? "");
        return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ product: productCopy, store: validStore }) }], usage: { input_tokens: 10, output_tokens: 10 } });
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
      return json({ errors: [{ message: `unexpected ${q.slice(0, 40)}` }] });
    }));

    const { t, productId, user } = await setup();
    const { launchId } = await user.mutation(api.launch.start, {
      productId, language: "Danish", tone: "friendly", publish: "ACTIVE", mode: "store", style: "nordic", brandName: "Rank Ryg",
      facts: { shippingTime: "5–8 hverdage", returnDays: 30, freeShippingFrom: 299, supportEmail: "hej@rankryg.dk" },
    });
    await t.finishAllScheduledFunctions(() => {});
    const l = await user.query(api.launch.get, { launchId });
    expect(l).toMatchObject({
      status: "published", mode: "store", style: "nordic", price: 79, productHandle: "rank-ryg",
      themeId: "gid://shopify/OnlineStoreTheme/77", themePreviewUrl: "https://rank.myshopify.com/?preview_theme_id=77",
      themeEditorUrl: "https://rank.myshopify.com/admin/themes/77/editor", pageHandles: { about: "about", contact: "contact-1" },
    });
    expect(prompt).toContain("Returns: within 30 days of delivery");
    expect(prompt).toContain("Free shipping on orders from 299 DKK");

    const productSet = calls.find((c) => c.query.includes("productSet"))!.variables.input as { descriptionHtml: string; variants: { price: string; inventoryItem: { cost: string } }[] };
    expect(productSet.variants[0]).toMatchObject({ price: "79.00", inventoryItem: { cost: "26.88" } });
    expect(productSet.descriptionHtml).toContain("<h3>Sådan virker det</h3>"); // Danish headings
    expect(productSet.descriptionHtml).not.toContain("Trækker skuldrene"); // the theme shows benefits itself
    expect(calls.filter((c) => c.query.includes("pageCreate"))).toHaveLength(4);
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

    // Going live is the user's call.
    expect(calls.some((c) => c.query.includes("themePublish"))).toBe(false);
    await user.mutation(api.launch.publishTheme, { launchId });
    await t.finishAllScheduledFunctions(() => {});
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({ themeLive: true });
  });
});
