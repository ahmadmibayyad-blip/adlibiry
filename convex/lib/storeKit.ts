// Launch → Full store: the facts the AI gets, the store copy it writes, the
// claim rules applied to it, and what it becomes in Shopify (pages, menus and
// the storefront theme's settings and home page). Pure and unit-tested.

import { scrubClaims, type LaunchCopy } from "./launchCopy";
import { DEFAULT_SECTIONS, type MirrorTier, type PageMirror } from "./pageMirror";
import { DEFAULT_HOME, type HomeSection } from "./siteMirror";
import { designSettings, type DesignWishes } from "./designWishes";
import { STORE_STYLES, type StoreStyle, type StoreStyleId } from "./storeStyles";
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
  /** Our theme's product page (templates/product.json); written in its own request, so it can be missing. */
  productPage?: ProductPageCopy;
  /** "What to expect" stages, only for a mirrored home page that has them (its own small request). */
  timeline?: TimelineCopy;
};

export type TimelineCopy = { heading: string; text: string; button: string; items: { label: string; title: string; text: string }[] };

export const TIMELINE_GUIDE =
  "Write a \"What to expect\" timeline for this product's home page: heading (max 6 words, one or two key words in [square brackets]), text (one short sentence), button (2–3 words, " +
  "to the product page) and 3–4 stages in time order, each with label (when: e.g. \"First use\", \"Week 2\", \"Day 30\"), title (max 6 " +
  "words) and text (1–2 sentences). Describe what using the product is like at each stage, from its facts: how it feels, how a routine " +
  "settles in. No guaranteed or medical results, no percentages, no before/after promises, no customer counts.";

/** The timeline's lengths, counts and claim rules; undefined with fewer than 2 stages. */
export function cleanTimeline(raw: unknown): TimelineCopy | undefined {
  const r = (raw ?? {}) as Partial<TimelineCopy>;
  const s = (v: unknown, n: number) => noAccent(scrubClaims(cut(v, n * 2)).text.slice(0, n));
  const h = (v: unknown, n: number) => accent(scrubClaims(cut(v, n * 2)).text.slice(0, n));
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => ({ label: s(x?.label, 24), title: s(x?.title, 60), text: s(x?.text, 220) }))
    .filter((x) => x.title && x.text)
    .slice(0, 4);
  return items.length >= 2 ? { heading: h(r.heading, 60), text: s(r.text, 160), button: s(r.button, 30), items } : undefined;
}

/** The product page's own copy: ticks, bundle cards, image-with-text rows, comparison table and tabs. */
export type ProductPageCopy = {
  ticks: string[];
  offer: string;
  bundles: { heading: string; tiers: { title: string; subtitle: string }[]; popular: string; best: string };
  sections: { eyebrow: string; heading: string; text: string; points: string[] }[];
  comparison: { heading: string; others: string; rows: { feature: string; us: Mark; others: Mark }[] };
  tabs: { heading: string; text: string }[];
  button: string;
  reviewsHeading: string;
};
export type Mark = "yes" | "partly" | "no";
const MARKS = ["yes", "partly", "no"] as const;

/** % off for 1, 2 and 3 items: the bundle cards and the automatic discounts Launch creates for them. */
export const BUNDLE_OFF = [0, 15, 25] as const;
/** Our deals as items and % off; a mirrored page brings its own (lib/pageMirror.ts). */
export const DEFAULT_TIERS: MirrorTier[] = BUNDLE_OFF.map((off, i) => ({ qty: i + 1, off }));

/** The least a deal keeps per item after the supplier cost: 30% of what the shopper pays for it. */
export const MIN_DEAL_MARGIN = 0.3;

/**
 * Deals that still make money: each deal's % off is lowered until every item in it keeps MIN_DEAL_MARGIN
 * over the supplier cost (price and cost in the store's currency, cost with shipping). A copied page's
 * deals were made for its own price, so they often go below cost at ours. Deals left with no saving drop
 * out; with fewer than 2, there are no bundle deals. The note says what changed, or that the cost is unknown.
 */
export function capDeals(tiers: MirrorTier[], price: number | undefined, cost: number | undefined, currency = ""): { tiers: MirrorTier[] | null; note?: string } {
  if (!price || price <= 0) return { tiers };
  if (!cost || cost <= 0) return { tiers, note: "No supplier cost is known for this product, so the bundle discounts weren't checked against your margin. Check them before you run ads." };
  const fmt = (n: number) => `${Math.round(n * 100) / 100}${currency ? ` ${currency}` : ""}`;
  // Lowest price per item that keeps the margin; the most % off that allows.
  const floor = cost / (1 - MIN_DEAL_MARGIN);
  const maxOff = Math.max(0, Math.floor((1 - floor / price) * 100));
  const lowered: string[] = [];
  const capped = tiers.map((t) => {
    if (t.off <= maxOff) return t;
    lowered.push(`${t.qty} ${t.qty === 1 ? "item" : "items"} −${t.off}% → −${maxOff}%`);
    return { ...t, off: maxOff };
  });
  // The same saving on more items adds nothing: keep the first of each.
  const kept = capped.filter((t, i) => i === 0 || t.off === 0 || t.off !== capped[i - 1].off);
  const margin = `at ${fmt(price)} with a supplier cost of ${fmt(cost)}, every item keeps at least ${MIN_DEAL_MARGIN * 100}% margin up to ${maxOff}% off`;
  if (kept.length < 2 || !kept.some((t) => t.off > 0)) {
    return { tiers: null, note: `No bundle deals: ${margin}, which leaves no room for a bundle discount. Raise the price to offer one.` };
  }
  return { tiers: kept, ...(lowered.length ? { note: `Bundle discounts lowered to keep your margin (${lowered.join(", ")}): ${margin}.` } : {}) };
}

/** What shoppers see as the discount's name in the cart and at checkout: "Køb flere · 2 fontæner". */
export function bundleTitles(pp: ProductPageCopy | undefined, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const tier = pp?.bundles.tiers[i]?.title || `${i + 1}+`;
    return (pp?.bundles.heading ? `${pp.bundles.heading} · ${tier}` : tier).slice(0, 255);
  });
}

export function productPageGuide(tiers: MirrorTier[] = DEFAULT_TIERS): string {
  const off = tiers.map((t) => t.off);
  const items = tiers.map((t) => t.qty);
  return (
    "Write the product page's extra copy: ticks (4 benefit lines, each “Short bold part – detail”, max 70 characters), " +
    `bundles (heading 2–4 words like “Bundle & save”; tiers: exactly ${tiers.length}, for ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]} items, which cost ${off.map((o) => `${o}%`).join(", ")} less; ` +
    "each with a title of 1–3 words naming the product itself with its count (e.g. “1 fountain”, “2 fountains”, not a part or accessory) and a " +
    "subtitle of max 40 characters; never write a price or number in it: write [unit] where the price per item goes (e.g. “Only [unit] each”, " +
    "“One for the bedroom”); popular: the badge for the most popular deal (“Most popular”), best: for the best-value deal (“Best value”)), " +
    `offer (one line about the real bundle saving: up to ${Math.max(...off)}% off when buying more; no dates or scarcity), ` +
    "sections (3 image-with-text rows: first the problem the product solves, then how it helps, then a detail buyers care about; " +
    "eyebrow 1–3 words, heading max 8 words, text 1–2 sentences, 3 short points), " +
    "comparison (heading max 6 words; others: what buyers would otherwise use, in general, e.g. “A water bowl” — never a brand; " +
    "4–5 rows of features from the facts, each with us and others as yes, partly or no; use partly or no only when the facts support it), " +
    "tabs (2–3 collapsible tabs for the product page, e.g. materials and specs, how to use and care; heading 1–3 words, text 2–4 sentences from the facts only), " +
    "button (2–3 words that take the reader back to the buy button) and reviewsHeading (max 5 words, for customer reviews). " +
    "Only facts from the product information; no invented numbers, results, reviews, awards or urgency."
  );
}

/** Lengths, counts and the claim rules on the product page copy; null when there's nothing usable. */
export function cleanProductPage(raw: unknown): ProductPageCopy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record<keyof ProductPageCopy, unknown>> & Record<string, unknown>;
  const s = (v: unknown, n: number) => scrubClaims(cut(v, n * 2)).text.slice(0, n);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const b = (r.bundles ?? {}) as { heading?: unknown; tiers?: unknown; popular?: unknown; best?: unknown };
  const cmp = (r.comparison ?? {}) as { heading?: unknown; others?: unknown; rows?: unknown };
  const page: ProductPageCopy = {
    ticks: arr<unknown>(r.ticks).map((x) => s(x, 90)).filter(Boolean).slice(0, 5),
    offer: s(r.offer, 80),
    bundles: {
      heading: s(b.heading, 40),
      tiers: arr<{ title?: unknown; subtitle?: unknown }>(b.tiers)
        .slice(0, 3)
        .map((t) => {
          const subtitle = s(t?.subtitle, 50);
          // A price written out ("152 kr each") goes stale with the price; the theme fills in [unit] itself.
          return { title: s(t?.title, 30), subtitle: /\d/.test(subtitle.replace(/\[unit\]/g, "")) ? "" : subtitle };
        }),
      popular: s(b.popular, 24),
      best: s(b.best, 24),
    },
    sections: arr<{ eyebrow?: unknown; heading?: unknown; text?: unknown; points?: unknown }>(r.sections)
      .map((x) => ({ eyebrow: s(x?.eyebrow, 40), heading: s(x?.heading, 80), text: s(x?.text, 300), points: arr<unknown>(x?.points).map((p) => s(p, 70)).filter(Boolean).slice(0, 4) }))
      .filter((x) => x.heading && x.text)
      .slice(0, 3),
    comparison: {
      heading: s(cmp.heading, 60),
      others: s(cmp.others, 30),
      rows: arr<{ feature?: unknown; us?: unknown; others?: unknown }>(cmp.rows)
        .map((x) => ({ feature: s(x?.feature, 60), us: pick(String(x?.us ?? "").toLowerCase(), MARKS, "yes"), others: pick(String(x?.others ?? "").toLowerCase(), MARKS, "no") }))
        .filter((x) => x.feature)
        .slice(0, 6),
    },
    tabs: arr<{ heading?: unknown; text?: unknown }>(r.tabs)
      .map((x) => ({ heading: s(x?.heading, 40), text: s(x?.text, 600) }))
      .filter((x) => x.heading && x.text)
      .slice(0, 3),
    button: s(r.button, 30),
    reviewsHeading: s(r.reviewsHeading, 50),
  };
  const empty = !page.ticks.length && !page.sections.length && !page.comparison.rows.length && !page.tabs.length && !page.bundles.tiers.length;
  return empty ? null : page;
}

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
  "stories, team members, locations, discounts, guarantees, endorsements, trust badges, stock scarcity or urgency. The About page talks about why the store picked this product and " +
  "what it cares about (quality checks, honest descriptions, responsive support), in plain words, without claiming a history. " +
  "Shipping and returns text uses only the store facts. Headings are short (max 8 words). Menu labels are one or two words.";

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Accent [brackets] (STORE_GUIDE): kept in the headings the theme turns into italics, one balanced pair at most,
 * and removed everywhere else, where the theme would show them as they are.
 */
const noAccent = (t: string) => t.replace(/[[\]]/g, "");
const accent = (t: string) => (/^[^[\]]*\[[^[\]]+\][^[\]]*$/.test(t) ? t : noAccent(t));
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Lengths, counts, allowed icons and the claim rules, on whatever the AI returned. */
export function cleanStore(raw: StoreCopy): StoreCopy {
  const s = (v: unknown, n: number) => noAccent(scrubClaims(cut(v, n * 2)).text.slice(0, n));
  const h = (v: unknown, n: number) => accent(scrubClaims(cut(v, n * 2)).text.slice(0, n));
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const texts = (v: unknown, max: number, n: number) => arr<unknown>(v).map((x) => s(x, n)).filter(Boolean).slice(0, max);
  const r = raw ?? ({} as StoreCopy);
  return {
    announcement: s(r.announcement, 90),
    hero: {
      eyebrow: s(r.hero?.eyebrow, 40),
      heading: h(r.hero?.heading, 80),
      text: s(r.hero?.text, 220),
      button: s(r.hero?.button, 30),
      points: texts(r.hero?.points, 3, 40),
    },
    trust: arr<{ icon: string; text: string }>(r.trust)
      .map((t) => ({ icon: pick(t?.icon, TRUST_ICONS, "shield"), text: s(t?.text, 40) }))
      .filter((t) => t.text)
      .slice(0, 4),
    benefits: {
      heading: h(r.benefits?.heading, 70),
      text: s(r.benefits?.text, 200),
      items: arr<{ icon: string; title: string; text: string }>(r.benefits?.items)
        .map((b) => ({ icon: pick(b?.icon, STORE_ICONS, "sparkle"), title: s(b?.title, 50), text: s(b?.text, 200) }))
        .filter((b) => b.title)
        .slice(0, 4),
    },
    steps: {
      heading: h(r.steps?.heading, 70),
      items: arr<{ title: string; text: string }>(r.steps?.items)
        .map((x) => ({ title: s(x?.title, 50), text: s(x?.text, 200) }))
        .filter((x) => x.title)
        .slice(0, 4),
    },
    story: { eyebrow: s(r.story?.eyebrow, 40), heading: h(r.story?.heading, 80), paragraphs: texts(r.story?.paragraphs, 3, 400), button: s(r.story?.button, 30) },
    faq: {
      heading: h(r.faq?.heading, 70),
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

export type StorePageKey = "about" | "shipping" | "faq" | "contact" | "track";
export const STORE_PAGE_HANDLES: Record<StorePageKey, string> = { about: "about", shipping: "shipping-returns", faq: "faq", contact: "contact", track: "track-order" };

/** The order tracking page's title in the launch's language (the theme's page.track template has the form). */
export const TRACK_PAGE_TITLES: Record<string, string> = {
  English: "Track your order", Danish: "Spor din ordre", German: "Bestellung verfolgen", Swedish: "Spåra din order", Norwegian: "Spor bestillingen",
  French: "Suivre ma commande", Spanish: "Seguir mi pedido", Dutch: "Bestelling volgen", Italian: "Traccia l'ordine", Polish: "Śledź zamówienie",
  Finnish: "Seuraa tilausta", Portuguese: "Rastrear pedido",
};

/** The four pages created in the store (Online Store → Pages). */
export function storePages(c: StoreCopy, facts: StoreFacts, language = "English"): Record<StorePageKey, { title: string; handle: string; body: string; templateSuffix?: string }> {
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
    track: { title: TRACK_PAGE_TITLES[language] ?? TRACK_PAGE_TITLES.English, handle: STORE_PAGE_HANDLES.track, body: "", templateSuffix: "track" },
  };
}

// ── menus ────────────────────────────────────────────────────────────────

export const STORE_MENU_HANDLES = { main: "adspy-main", footer: "adspy-footer" } as const;

type MenuItem = { title: string; type: string; url?: string; resourceId?: string };

/** A product title short enough for the header menu: the part before a dash or colon, cut at a word. */
export function menuLabel(title: string, max = 30): string {
  const head = title.split(/\s[–—-]\s|:|\||,/)[0].trim() || title.trim();
  let label = "";
  for (const word of head.split(/\s+/)) {
    const next = label ? `${label} ${word}` : word;
    if (next.length > max) break;
    label = next;
  }
  return label || head.slice(0, max);
}

/** Header and footer menus. Our own handles, so the live theme's menus stay as they are. */
export function storeMenus(c: StoreCopy, ids: { productId: string; pages: Partial<Record<StorePageKey, string>> }, productTitle: string, trackTitle?: string) {
  const page = (key: StorePageKey, title: string): MenuItem[] => (ids.pages[key] ? [{ title, type: "PAGE", resourceId: ids.pages[key] }] : []);
  const main: MenuItem[] = [
    { title: c.menu.home, type: "FRONTPAGE", url: "/" },
    { title: c.menu.shop, type: "CATALOG", url: "/collections/all" },
    { title: menuLabel(productTitle), type: "PRODUCT", resourceId: ids.productId },
    ...page("about", c.menu.about),
    ...page("faq", c.menu.faq),
    ...page("contact", c.menu.contact),
  ];
  const footer: MenuItem[] = [
    ...page("track", trackTitle ?? TRACK_PAGE_TITLES.English),
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
  /** % off for each deal when Launch created the matching automatic discounts; no bundle cards without. */
  bundleOff?: number[];
  /** Items in each deal; missing = 1, 2 and 3. */
  bundleQty?: number[];
  /** The layout copied from another page (lib/pageMirror.ts); missing = our own. */
  mirror?: PageMirror;
  /** Look changes from the owner's special requests (lib/designWishes.ts), over the style and a mirrored look. */
  design?: DesignWishes;
  /** How many AI photos the product got: they're its 2nd, 3rd… photos (lib/aiPhotos.ts withAiPhotos). */
  aiPhotos?: number;
};

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** "5–10 business days" → 5 and 10; "1–2 uger" (weeks) → 5 and 10 business days; null without numbers. For the cart's delivery dates. */
export function deliveryDays(text: string): { min: number; max: number } | null {
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).slice(0, 2);
  if (!nums.length) return null;
  const perUnit = /week|wk|uge|woche|veck|uke|semaine|semana|settiman|tydz|tygod|viik/i.test(text) ? 5 : 1;
  const [a, b = a] = nums.map((n) => n * perUnit);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return max > 0 && max <= 90 ? { min, max } : null;
}

/** A style's Theme settings, its fonts included: the preset of the same name in settings_data.json. */
export function styleSettings(s: StoreStyle): Record<string, unknown> {
  return { ...s.settings, ...fontSettings(s.customFonts) };
}

/** Theme settings for Google fonts by name (theme-style.liquid); empty ones keep the font pair. */
function fontSettings(f: { head: string; body: string; headWeight: number; bodyWeights: string } | undefined) {
  return { custom_head_font: f?.head ?? "", custom_body_font: f?.body ?? "", custom_head_weight: String(f?.headWeight ?? 700), custom_body_weights: f?.bodyWeights ?? "400;500;600;700" };
}

/** The scrolling text's lines: the trust lines and benefit titles the AI already wrote, no new claims. */
export function marqueeTexts(c: StoreCopy): string[] {
  return [...new Set([...c.trust.map((x) => x.text), ...c.benefits.items.map((b) => b.title)].filter(Boolean))].slice(0, 6);
}

/** The store-specific files that replace the theme's defaults: settings, home page, header and footer. */
export function themeOverrides(t: ThemeInput): Record<string, string> {
  const style = STORE_STYLES[t.style];
  const c = t.copy;
  const presets = Object.fromEntries(Object.values(STORE_STYLES).map((s) => [s.name, styleSettings(s)]));
  const look = t.mirror?.look;
  const days = deliveryDays(t.facts.shippingTime);
  const settings = {
    current: {
      ...styleSettings(style),
      page_width: 1240,
      brand_name: t.brandName,
      trust_line_1: c.productTrust.shipping,
      trust_line_2: c.productTrust.returns,
      trust_line_3: c.productTrust.payment,
      cart_type: "drawer",
      free_shipping_threshold: t.facts.freeShippingFrom ? Math.round(t.facts.freeShippingFrom) : 0,
      delivery_min_days: days?.min ?? 0,
      delivery_max_days: days?.max ?? 0,
      show_add_another: true,
      show_payment_icons: true,
      guarantee_days: t.facts.returnDays > 0 ? t.facts.returnDays : 0,
      // A mirrored store's own colors and fonts (lib/siteMirror.ts siteLook) over the style's.
      ...(look?.colors
        ? {
            color_bg: look.colors.bg,
            color_surface: look.colors.surface,
            color_text: look.colors.text,
            color_accent: look.colors.accent,
            color_accent_text: look.colors.accentText,
          }
        : {}),
      ...(look?.fonts ? fontSettings({ headWeight: 700, bodyWeights: "400;500;600;700", ...look.fonts }) : {}),
      ...(look?.uppercase ? { heading_uppercase: true } : {}),
    },
    presets,
  };
  if (t.design) Object.assign(settings.current, designSettings(t.design, settings.current));

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
        layout: t.design?.heroLayout ?? style.heroLayout,
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
    // Shows the product's supplier reviews when the launch added them, nothing otherwise.
    reviews: { type: "reviews", settings: { product: t.productHandle, scheme: style.schemes.story === "surface" ? "base" : "surface" } },
    faq: { type: "faq", settings: { heading: c.faq.heading, scheme: style.schemes.faq }, ...blocks("f", c.faq.items.slice(0, 6), "question", (f) => ({ question: f.q, answer: `<p>${esc(f.a)}</p>` })) },
    newsletter: { type: "newsletter", settings: { heading: c.newsletter.heading, text: c.newsletter.text, scheme: style.schemes.newsletter } },
    // Only a mirrored home page has these three.
    ...(c.timeline
      ? {
          timeline: {
            type: "timeline",
            settings: { heading: c.timeline.heading, text: c.timeline.text, button_label: c.timeline.button, product: t.productHandle, scheme: style.schemes.steps },
            ...blocks("s", c.timeline.items, "stage", (x) => ({ label: x.label, title: x.title, text: x.text })),
          },
        }
      : {}),
    marquee: { type: "marquee", settings: { scheme: "accent" }, ...blocks("m", marqueeTexts(c), "item", (text) => ({ text })) },
    guarantee: { type: "guarantee", settings: { button_label: c.hero.button || c.menu.shop, button_link: `/products/${t.productHandle}`, scheme: "surface" } },
  };
  // A mirrored store's home page follows its order (lib/siteMirror.ts homePlan); else ours.
  const plan: HomeSection[] = t.mirror?.home?.length ? t.mirror.home : DEFAULT_HOME;
  const order = plan.filter((k) => {
    if (k === "benefits") return c.benefits.items.length > 0;
    if (k === "steps") return c.steps.items.length > 0;
    if (k === "faq") return c.faq.items.length > 0;
    if (k === "trust") return c.trust.length > 0;
    if (k === "story") return c.story.heading && c.story.paragraphs.length > 0;
    if (k === "timeline") return !!c.timeline;
    if (k === "marquee") return marqueeTexts(c).length >= 2;
    if (k === "guarantee") return t.facts.returnDays > 0;
    return true;
  });

  return {
    "config/settings_data.json": json(settings),
    "templates/index.json": json({ sections: Object.fromEntries(order.map((k) => [k, sections[k]])), order }),
    "templates/product.json": json(productTemplate(t)),
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

/** The launch's deals as items and % off, when its discounts exist: 2–3 deals with some saving. */
export function bundleDeals(t: Pick<ThemeInput, "bundleOff" | "bundleQty">): MirrorTier[] | null {
  const off = t.bundleOff;
  if (!off || off.length < 2 || off.length > 3 || !off.some((o) => o > 0)) return null;
  const qty = t.bundleQty?.length === off.length ? t.bundleQty : off.map((_, i) => i + 1);
  return off.map((o, i) => ({ qty: qty[i], off: o }));
}

/** The bundles block's settings, the same in both themes: up to 3 deals (0 items hides one), the chosen one and the badges. */
export function bundleSettings(deals: MirrorTier[], pp: ProductPageCopy | undefined, mirror?: PageMirror): Record<string, unknown> {
  // Badges: the mirrored page's, else "Most popular" on deal 2 and "Best value" on deal 3.
  const badges = mirror?.tiers ? mirror.badges ?? [] : [2, 3];
  const badge = (n: number) => (badges[0] === n ? pp?.bundles.popular ?? "" : badges[1] === n ? pp?.bundles.best ?? "" : "");
  const preselect = Math.min(deals.length, Math.max(1, (mirror?.tiers ? mirror.preselect : undefined) ?? 2));
  return {
    heading: pp?.bundles.heading ?? "",
    preselect: String(preselect),
    unit_price: true,
    ...Object.fromEntries(
      [0, 1, 2].flatMap((i) => [
        [`tier${i + 1}_qty`, deals[i]?.qty ?? 0],
        [`tier${i + 1}_title`, deals[i] ? pp?.bundles.tiers[i]?.title ?? "" : ""],
        [`tier${i + 1}_subtitle`, deals[i] ? pp?.bundles.tiers[i]?.subtitle ?? "" : ""],
        [`tier${i + 1}_off`, deals[i]?.off ?? 0],
        [`tier${i + 1}_badge`, deals[i] ? badge(i + 1) : ""],
        [`tier${i + 1}_gift`, ""],
      ]),
    ),
  };
}

type Block = { type: string; settings: Record<string, unknown> };
const blockList = (list: [string, Block | null][]) => {
  const kept = list.filter((e): e is [string, Block] => e[1] !== null);
  return { blocks: Object.fromEntries(kept), block_order: kept.map(([k]) => k) };
};

/**
 * The product page (sections/main-product.liquid's blocks and the sections under it), like the stores
 * selling with Meta ads: stars, ticks, offer and stock, bundle cards (only with Launch's discounts),
 * guarantee, trust icons and tabs; then image-with-text rows, a comparison table, reviews and FAQ.
 * A mirrored page (t.mirror) sets the sections' order, the deals and which buy-box extras show.
 */
export function productTemplate(t: ThemeInput) {
  const pp = t.copy.productPage;
  const m = t.mirror;
  const deals = bundleDeals(t);
  const bundles: Block | null = deals ? { type: "bundles", settings: bundleSettings(deals, pp, m) } : null;
  const tabs = (pp?.tabs ?? []).map((x, i) => [`tab${i + 1}`, { type: "collapsible_tab", settings: { heading: x.heading, icon: ["leaf", "check", "sparkle"][i] ?? "none", content: `<p>${esc(x.text)}</p>`, open: false } }] as [string, Block]);
  const main = {
    type: "main-product",
    settings: { sticky_bar: m?.sticky ?? true },
    ...blockList([
      ["rating", { type: "rating", settings: {} }],
      ["title", { type: "title", settings: {} }],
      ["subtitle", { type: "subtitle", settings: {} }],
      ["price", { type: "price", settings: {} }],
      ["benefits", { type: "benefits", settings: { lines: (pp?.ticks ?? []).join("\n") } }],
      ["urgency", { type: "urgency", settings: { offer: deals ? pp?.offer ?? "" : "", stock_below: 10, show_in_stock: true } }],
      ["variant_picker", { type: "variant_picker", settings: { style: "buttons" } }],
      ["bundles", bundles],
      ["buy_buttons", { type: "buy_buttons", settings: { show_quantity: !deals, show_dynamic_checkout: true } }],
      ["guarantee", m?.guarantee === false ? null : { type: "guarantee", settings: {} }],
      ["trust_icons", { type: "trust_icons", settings: {} }],
      ["payment_icons", { type: "payment_icons", settings: {} }],
      ["delivery", m?.delivery === false ? null : { type: "delivery", settings: {} }],
      ["description", { type: "description", settings: { collapsible: true, open: false } }],
      ...tabs,
    ]),
  };

  const style = STORE_STYLES[t.style];
  const soft = style.schemes.story === "surface" ? "base" : "surface";
  // Rows show the AI photos; without one, the main photo. The supplier's other photos are often infographics
  // in English or other models of the product.
  const ai = t.aiPhotos ?? 0;
  const rows = (pp?.sections ?? []).map((x, i) => ({
    type: "image-with-text",
    settings: {
      image_index: ai > 0 ? 2 + (i % ai) : 1,
      image_right: i % 2 === 1,
      eyebrow: x.eyebrow,
      heading: x.heading,
      text: `<p>${esc(x.text)}</p>`,
      points: x.points.join("\n"),
      button_label: i === 0 ? "" : pp?.button ?? "",
      button_solid: true,
      scheme: i % 2 === 0 ? "base" : soft,
    },
  }));
  const sections: Record<string, unknown> = { main };
  const order = ["main"];
  const add = (key: string, section: unknown) => {
    sections[key] = section;
    order.push(key);
  };
  let row = 0;
  for (const kind of m?.sections ?? DEFAULT_SECTIONS) {
    if (kind === "row") {
      if (rows[row]) add(row === 0 ? "problem" : `row${row + 1}`, rows[row]);
      row++;
    } else if (kind === "comparison") {
      if (pp && pp.comparison.rows.length >= 3) {
        add("comparison", {
          type: "comparison",
          settings: { heading: pp.comparison.heading, us_label: t.brandName, them_1: pp.comparison.others, button_label: pp.button, scheme: soft },
          ...blockList(pp.comparison.rows.map((r, i) => [`row${i + 1}`, { type: "row", settings: { feature: r.feature, us: r.us, them_1: r.others } }])),
        });
      }
    } else if (kind === "reviews") {
      // The owner's own reviews (hidden until they add some), then the supplier's when Launch added them.
      add("testimonials", { type: "testimonials", settings: { heading: pp?.reviewsHeading ?? "", show_summary: true, layout: "slider", scheme: "surface" } });
      add("reviews", { type: "reviews", settings: { scheme: "base" } });
    } else if (kind === "guarantee") {
      add("guarantee", { type: "guarantee", settings: { button_label: pp?.button ?? "", scheme: "surface" } });
    } else {
      add("faq", { type: "faq", settings: { heading: t.copy.faq.heading, product_questions: true, scheme: "base" } });
    }
  }
  return { sections, order };
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
