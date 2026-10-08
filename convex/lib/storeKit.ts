// Launch → Full store: the facts the AI gets, the store copy it writes, the
// claim rules applied to it, and what it becomes in Shopify (pages, menus and
// the storefront theme's settings and home page). Pure and unit-tested.

import { scrubClaims, type LaunchCopy } from "./launchCopy";
import { STORE_STYLES, type StoreStyleId } from "./storeStyles";
import { THEME_FILES } from "./themeFiles.generated";

export const STORE_ICONS = ["sparkle", "heart", "leaf", "bolt", "shield", "clock", "smile", "star", "drop", "sun", "home", "paw", "gift", "check"] as const;
export const TRUST_ICONS = ["truck", "shield", "return", "chat", "lock", "clock", "gift", "star"] as const;

export type StoreFacts = {
  /** What the merchant told us; the AI may only promise these. */
  shippingTime: string;
  returnDays: number;
  freeShippingFrom?: number;
  supportEmail?: string;
  currency: string;
};

export type StoreCopy = {
  announcement: string;
  hero: { eyebrow: string; heading: string; text: string; button: string; points: string[] };
  trust: { icon: string; text: string }[];
  benefits: { heading: string; text: string; items: { icon: string; title: string; text: string }[] };
  steps: { heading: string; items: { title: string; text: string }[] };
  story: { eyebrow: string; heading: string; paragraphs: string[]; button: string };
  faq: { heading: string; items: { q: string; a: string }[] };
  newsletter: { heading: string; text: string };
  footerText: string;
  productTrust: { shipping: string; returns: string; payment: string };
  pages: {
    about: { title: string; paragraphs: string[] };
    shipping: { title: string; paragraphs: string[] };
    faq: { title: string };
    contact: { title: string; intro: string };
  };
  menu: { home: string; shop: string; about: string; faq: string; contact: string; shipping: string; search: string };
};

export function storeFacts(f: StoreFacts): string {
  return [
    "Store facts from the owner (the only shipping/returns promises you may make):",
    `- Delivery time: ${f.shippingTime}`,
    `- Returns: within ${f.returnDays} days of delivery`,
    f.freeShippingFrom ? `- Free shipping on orders from ${f.freeShippingFrom} ${f.currency}` : "- No free-shipping offer: don't mention one",
    f.supportEmail ? `- Support email: ${f.supportEmail}` : "- Support: through the contact form",
  ].join("\n");
}

export const STORE_SYSTEM =
  "You also write the rest of a one-product dropshipping store: home page, About, Shipping & returns, FAQ and Contact pages, " +
  "menu labels and short UI lines, all in the requested language. The store sells the product described; the brand is the store " +
  "name given. Same rules as the product page: only real facts, no invented reviews, ratings, customer counts, awards, founding " +
  "stories, team members, locations, discounts or guarantees. The About page talks about why the store picked this product and " +
  "what it cares about (quality checks, honest descriptions, responsive support), in plain words, without claiming a history. " +
  "Shipping and returns text uses only the store facts. Headings are short (max 8 words). Menu labels are one or two words.";

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Lengths, counts, allowed icons and the claim rules, on whatever the AI returned. */
export function cleanStore(raw: StoreCopy): StoreCopy {
  const s = (v: unknown, n: number) => scrubClaims(cut(v, n * 2)).text.slice(0, n);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const texts = (v: unknown, max: number, n: number) => arr<unknown>(v).map((x) => s(x, n)).filter(Boolean).slice(0, max);
  const r = raw ?? ({} as StoreCopy);
  return {
    announcement: s(r.announcement, 90),
    hero: {
      eyebrow: s(r.hero?.eyebrow, 40),
      heading: s(r.hero?.heading, 80),
      text: s(r.hero?.text, 220),
      button: s(r.hero?.button, 30),
      points: texts(r.hero?.points, 3, 40),
    },
    trust: arr<{ icon: string; text: string }>(r.trust)
      .map((t) => ({ icon: pick(t?.icon, TRUST_ICONS, "shield"), text: s(t?.text, 40) }))
      .filter((t) => t.text)
      .slice(0, 4),
    benefits: {
      heading: s(r.benefits?.heading, 70),
      text: s(r.benefits?.text, 200),
      items: arr<{ icon: string; title: string; text: string }>(r.benefits?.items)
        .map((b) => ({ icon: pick(b?.icon, STORE_ICONS, "sparkle"), title: s(b?.title, 50), text: s(b?.text, 200) }))
        .filter((b) => b.title)
        .slice(0, 4),
    },
    steps: {
      heading: s(r.steps?.heading, 70),
      items: arr<{ title: string; text: string }>(r.steps?.items)
        .map((x) => ({ title: s(x?.title, 50), text: s(x?.text, 200) }))
        .filter((x) => x.title)
        .slice(0, 4),
    },
    story: { eyebrow: s(r.story?.eyebrow, 40), heading: s(r.story?.heading, 80), paragraphs: texts(r.story?.paragraphs, 3, 400), button: s(r.story?.button, 30) },
    faq: {
      heading: s(r.faq?.heading, 70),
      items: arr<{ q: string; a: string }>(r.faq?.items)
        .map((f) => ({ q: s(f?.q, 140), a: s(f?.a, 500) }))
        .filter((f) => f.q && f.a)
        .slice(0, 8),
    },
    newsletter: { heading: s(r.newsletter?.heading, 70), text: s(r.newsletter?.text, 200) },
    footerText: s(r.footerText, 240),
    productTrust: { shipping: s(r.productTrust?.shipping, 60), returns: s(r.productTrust?.returns, 60), payment: s(r.productTrust?.payment, 60) },
    pages: {
      about: { title: s(r.pages?.about?.title, 60), paragraphs: texts(r.pages?.about?.paragraphs, 6, 700) },
      shipping: { title: s(r.pages?.shipping?.title, 60), paragraphs: texts(r.pages?.shipping?.paragraphs, 8, 700) },
      faq: { title: s(r.pages?.faq?.title, 60) },
      contact: { title: s(r.pages?.contact?.title, 60), intro: s(r.pages?.contact?.intro, 400) },
    },
    menu: {
      home: s(r.menu?.home, 24) || "Home",
      shop: s(r.menu?.shop, 24) || "Shop",
      about: s(r.menu?.about, 24) || "About",
      faq: s(r.menu?.faq, 24) || "FAQ",
      contact: s(r.menu?.contact, 24) || "Contact",
      shipping: s(r.menu?.shipping, 32) || "Shipping & returns",
      search: s(r.menu?.search, 24) || "Search",
    },
  };
}

// ── pages ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (list: string[]) => list.map((p) => `<p>${esc(p)}</p>`).join("\n");

export type StorePageKey = "about" | "shipping" | "faq" | "contact";
export const STORE_PAGE_HANDLES: Record<StorePageKey, string> = { about: "about", shipping: "shipping-returns", faq: "faq", contact: "contact" };

/** The four pages created in the store (Online Store → Pages). */
export function storePages(c: StoreCopy, facts: StoreFacts): Record<StorePageKey, { title: string; handle: string; body: string; templateSuffix?: string }> {
  const faqItems = c.faq.items;
  return {
    about: { title: c.pages.about.title || c.menu.about, handle: STORE_PAGE_HANDLES.about, body: paras(c.pages.about.paragraphs) },
    shipping: { title: c.pages.shipping.title || c.menu.shipping, handle: STORE_PAGE_HANDLES.shipping, body: paras(c.pages.shipping.paragraphs) },
    faq: {
      title: c.pages.faq.title || c.menu.faq,
      handle: STORE_PAGE_HANDLES.faq,
      body: faqItems.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n"),
    },
    contact: {
      title: c.pages.contact.title || c.menu.contact,
      handle: STORE_PAGE_HANDLES.contact,
      body: [c.pages.contact.intro ? `<p>${esc(c.pages.contact.intro)}</p>` : "", facts.supportEmail ? `<p><a href="mailto:${esc(facts.supportEmail)}">${esc(facts.supportEmail)}</a></p>` : ""]
        .filter(Boolean)
        .join("\n"),
      templateSuffix: "contact",
    },
  };
}

// ── menus ────────────────────────────────────────────────────────────────

export const STORE_MENU_HANDLES = { main: "adspy-main", footer: "adspy-footer" } as const;

type MenuItem = { title: string; type: string; url?: string; resourceId?: string };

/** Header and footer menus. Our own handles, so the live theme's menus stay as they are. */
export function storeMenus(c: StoreCopy, ids: { productId: string; pages: Partial<Record<StorePageKey, string>> }, productTitle: string) {
  const page = (key: StorePageKey, title: string): MenuItem[] => (ids.pages[key] ? [{ title, type: "PAGE", resourceId: ids.pages[key] }] : []);
  const main: MenuItem[] = [
    { title: c.menu.home, type: "FRONTPAGE", url: "/" },
    { title: c.menu.shop, type: "CATALOG", url: "/collections/all" },
    { title: productTitle.slice(0, 40), type: "PRODUCT", resourceId: ids.productId },
    ...page("about", c.menu.about),
    ...page("faq", c.menu.faq),
    ...page("contact", c.menu.contact),
  ];
  const footer: MenuItem[] = [
    ...page("shipping", c.menu.shipping),
    ...page("faq", c.menu.faq),
    ...page("contact", c.menu.contact),
    { title: c.menu.search, type: "SEARCH", url: "/search" },
  ];
  return { main, footer };
}

// ── theme ────────────────────────────────────────────────────────────────

export type ThemeInput = {
  style: StoreStyleId;
  brandName: string;
  productHandle: string;
  /** Handles of the pages as created (Shopify may add "-1" when one is taken). */
  pageHandles?: Partial<Record<StorePageKey, string>>;
  copy: StoreCopy;
  product: Pick<LaunchCopy, "title">;
  facts: StoreFacts;
};

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** The store-specific files that replace the theme's defaults: settings, home page, header and footer. */
export function themeOverrides(t: ThemeInput): Record<string, string> {
  const style = STORE_STYLES[t.style];
  const c = t.copy;
  const presets = Object.fromEntries(Object.values(STORE_STYLES).map((s) => [s.name, { ...s.settings }]));
  const settings = {
    current: {
      ...style.settings,
      page_width: 1240,
      brand_name: t.brandName,
      trust_line_1: c.productTrust.shipping,
      trust_line_2: c.productTrust.returns,
      trust_line_3: c.productTrust.payment,
      cart_type: "drawer",
      free_shipping_threshold: t.facts.freeShippingFrom ? Math.round(t.facts.freeShippingFrom) : 0,
    },
    presets,
  };

  const blocks = <T>(prefix: string, items: T[], type: string, settings: (x: T) => Record<string, unknown>) => {
    const entries = items.map((x, i) => [`${prefix}${i + 1}`, { type, settings: settings(x) }] as const);
    return { blocks: Object.fromEntries(entries), block_order: entries.map(([k]) => k) };
  };

  const sections: Record<string, unknown> = {
    hero: {
      type: "hero",
      settings: {
        eyebrow: c.hero.eyebrow,
        heading: c.hero.heading || t.product.title,
        text: c.hero.text,
        button_label: c.hero.button || c.menu.shop,
        product: t.productHandle,
        layout: style.heroLayout,
        scheme: style.schemes.hero,
      },
      ...blocks("p", c.hero.points, "point", (text) => ({ text })),
    },
    trust: { type: "trust-bar", settings: { scheme: style.schemes.trust }, ...blocks("t", c.trust, "item", (x) => ({ icon: x.icon, text: x.text })) },
    product: { type: "featured-product", settings: { product: t.productHandle, show_description: false, show_dynamic_checkout: true, scheme: "base" } },
    benefits: {
      type: "benefits",
      settings: { heading: c.benefits.heading, text: c.benefits.text, layout: style.benefitsLayout, scheme: style.schemes.benefits },
      ...blocks("b", c.benefits.items, "benefit", (b) => ({ icon: b.icon, title: b.title, text: b.text })),
    },
    steps: { type: "steps", settings: { heading: c.steps.heading, scheme: style.schemes.steps }, ...blocks("s", c.steps.items, "step", (x) => ({ title: x.title, text: x.text })) },
    story: {
      type: "image-with-text",
      settings: {
        product: t.productHandle,
        image_right: true,
        eyebrow: c.story.eyebrow,
        heading: c.story.heading,
        text: paras(c.story.paragraphs),
        button_label: c.story.button,
        button_link: `/pages/${t.pageHandles?.about ?? STORE_PAGE_HANDLES.about}`,
        scheme: style.schemes.story,
      },
    },
    faq: { type: "faq", settings: { heading: c.faq.heading, scheme: style.schemes.faq }, ...blocks("f", c.faq.items.slice(0, 6), "question", (f) => ({ question: f.q, answer: `<p>${esc(f.a)}</p>` })) },
    newsletter: { type: "newsletter", settings: { heading: c.newsletter.heading, text: c.newsletter.text, scheme: style.schemes.newsletter } },
  };
  const order = ["hero", "trust", "product", "benefits", "steps", "story", "faq", "newsletter"].filter((k) => {
    if (k === "benefits") return c.benefits.items.length > 0;
    if (k === "steps") return c.steps.items.length > 0;
    if (k === "faq") return c.faq.items.length > 0;
    if (k === "trust") return c.trust.length > 0;
    if (k === "story") return c.story.heading && c.story.paragraphs.length > 0;
    return true;
  });

  return {
    "config/settings_data.json": json(settings),
    "templates/index.json": json({ sections: Object.fromEntries(order.map((k) => [k, sections[k]])), order }),
    "sections/header-group.json": json({
      type: "header",
      name: "Header",
      sections: {
        announcement: { type: "announcement-bar", settings: { text: c.announcement } },
        header: { type: "header", settings: { menu: STORE_MENU_HANDLES.main, sticky: true } },
      },
      order: ["announcement", "header"],
    }),
    "sections/footer-group.json": json({
      type: "footer",
      name: "Footer",
      sections: {
        footer: {
          type: "footer",
          settings: { text: c.footerText ? `<p>${esc(c.footerText)}</p>` : "", menu: STORE_MENU_HANDLES.footer, newsletter: true, newsletter_heading: c.newsletter.heading },
        },
      },
      order: ["footer"],
    }),
  };
}

/** Every file of the store's theme: the bundled theme with this store's settings and pages on top. */
export function themeFiles(t: ThemeInput): Record<string, string> {
  return { ...THEME_FILES, ...themeOverrides(t) };
}

// ── signed theme download (Shopify fetches the zip from us) ──────────────

/** The secret the theme download link is signed with (storeThemeHttp.ts checks it). */
export function themeSecret(): string | undefined {
  return process.env.SHOPIFY_TOKEN_KEY?.trim() || process.env.SHOPIFY_API_SECRET?.trim() || undefined;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function themeSignature(launchId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`theme:${launchId}`)));
}

export async function themeSignatureOk(launchId: string, sig: string, secret: string): Promise<boolean> {
  const want = await themeSignature(launchId, secret);
  if (sig.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
