// Offer Search: find the stores advertising an offer ("Buy 2 get 1", "50% off", "Free shipping") in a
// country right now. The offer is searched in Meta's public Ad Library in the country's own language
// (convex/offerSearch.ts runs it through Apify), and the active ads that come back are grouped by the
// store they link to, with their offer chips (lib/offerTags.ts). Pure and unit tested.

import type { PictureMatch } from "./aliexpress";
import { offerTags, type OfferKind } from "./offerTags";
import { bigBrandIn } from "./productMatch";

export type OfferId = "bxgy" | "percent" | "free_shipping" | "free_gift" | "multibuy";
export type Lang = "en" | "da" | "sv" | "no" | "de" | "nl" | "fr" | "es";

/** The offers to pick from, and the words people use for them in each language (most common first). */
/** Each offer's words per language: `phrases` for the search (most common first), `more` for "Find more" (other ones). */
export const OFFERS: Record<OfferId, { label: string; phrases: Record<Lang, string[]>; more: Record<Lang, string[]> }> = {
  bxgy: {
    label: "Buy 2 get 1",
    phrases: {
      en: ["buy 1 get 1 free", "buy 2 get 1 free", "3 for 2"],
      da: ["1+1 gratis", "2+1 gratis", "køb 2 få 1 gratis"],
      sv: ["1+1 gratis", "2+1 gratis", "3 för 2"],
      no: ["1+1 gratis", "2+1 gratis", "3 for 2"],
      de: ["1+1 gratis", "2+1 gratis", "3 für 2"],
      nl: ["2+1 gratis", "1+1 gratis", "3 halen 2 betalen"],
      fr: ["1 acheté 1 offert", "2 achetés 1 offert", "1+1 offert"],
      es: ["2x1", "3x2", "compra 2 llévate 3"],
    },
    more: {
      en: ["2+1 free", "1+1 free", "bogo"],
      da: ["køb 1 få 1 gratis", "3 for 2", "kun i dag 1+1"],
      sv: ["köp 2 få 1 gratis", "köp 1 få 1 gratis", "endast idag 1+1"],
      no: ["kjøp 2 få 1 gratis", "kjøp 1 få 1 gratis", "kun i dag 1+1"],
      de: ["kaufe 2 erhalte 1 gratis", "nur heute 1+1", "3 zum Preis von 2"],
      nl: ["tijdelijk 1+1", "3 voor 2", "alleen vandaag 1+1"],
      fr: ["2+1 offert", "3 pour 2", "aujourd'hui seulement 1+1"],
      es: ["compra 1 llévate 2", "3 por 2", "solo hoy 2x1"],
    },
  },
  percent: {
    label: "% off",
    phrases: {
      en: ["50% off", "40% off", "60% off"],
      da: ["50% rabat", "40% rabat", "60% rabat"],
      sv: ["50% rabatt", "40% rabatt", "60% rabatt"],
      no: ["50% rabatt", "40% rabatt", "60% rabatt"],
      de: ["50% Rabatt", "40% Rabatt", "60% Rabatt"],
      nl: ["50% korting", "40% korting", "60% korting"],
      fr: ["-50%", "50% de réduction", "-40%"],
      es: ["50% de descuento", "40% de descuento", "60% de descuento"],
    },
    more: {
      en: ["70% off", "up to 50% off", "today only 50% off"],
      da: ["70% rabat", "op til 50% rabat", "kun i dag 50%"],
      sv: ["70% rabatt", "upp till 50% rabatt", "endast idag 50%"],
      no: ["70% rabatt", "opptil 50% rabatt", "kun i dag 50%"],
      de: ["70% Rabatt", "bis zu 50% Rabatt", "nur heute 50%"],
      nl: ["70% korting", "tot 50% korting", "alleen vandaag 50%"],
      fr: ["-70%", "jusqu'à -50%", "-60%"],
      es: ["70% de descuento", "hasta 50% de descuento", "solo hoy 50%"],
    },
  },
  free_shipping: {
    label: "Free shipping",
    phrases: {
      en: ["free shipping", "free delivery"],
      da: ["gratis fragt", "gratis levering", "fri fragt"],
      sv: ["fri frakt", "gratis frakt"],
      no: ["gratis frakt", "fri frakt"],
      de: ["kostenloser Versand", "gratis Versand", "versandkostenfrei"],
      nl: ["gratis verzending", "gratis bezorging"],
      fr: ["livraison gratuite", "livraison offerte"],
      es: ["envío gratis", "envío gratuito"],
    },
    more: {
      en: ["free shipping today", "free shipping worldwide"],
      da: ["gratis fragt i dag", "fri levering"],
      sv: ["fri frakt idag", "fri leverans"],
      no: ["gratis frakt i dag", "fri levering"],
      de: ["gratis Lieferung", "kostenlose Lieferung"],
      nl: ["gratis verzending vandaag", "gratis levering"],
      fr: ["livraison gratuite aujourd'hui", "livraison offerte aujourd'hui"],
      es: ["envío gratis hoy", "envío gratuito hoy"],
    },
  },
  free_gift: {
    label: "Free gift",
    phrases: {
      en: ["free gift"],
      da: ["gratis gave"],
      sv: ["gratis present"],
      no: ["gratis gave"],
      de: ["gratis Geschenk"],
      nl: ["gratis cadeau"],
      fr: ["cadeau offert"],
      es: ["regalo gratis"],
    },
    more: {
      en: ["free gift with every order", "gift included"],
      da: ["gratis gave med", "gave med i købet"],
      sv: ["gratis present med", "gåva på köpet"],
      no: ["gratis gave med", "gave på kjøpet"],
      de: ["Geschenk gratis", "gratis Geschenk dazu"],
      nl: ["gratis cadeau bij", "cadeau bij je bestelling"],
      fr: ["cadeau gratuit", "un cadeau offert"],
      es: ["regalo con tu pedido", "con regalo"],
    },
  },
  multibuy: {
    label: "Buy more, save more",
    phrases: {
      en: ["buy more save more", "bundle and save"],
      da: ["køb flere spar mere"],
      sv: ["köp fler spara mer"],
      no: ["kjøp flere spar mer"],
      de: ["mehr kaufen mehr sparen"],
      nl: ["meer kopen meer besparen"],
      fr: ["achetez plus économisez plus"],
      es: ["compra más ahorra más"],
    },
    more: {
      en: ["the more you buy the more you save", "bundle deal"],
      da: ["jo flere jo billigere", "pakketilbud"],
      sv: ["ju fler desto billigare", "paketpris"],
      no: ["jo flere jo billigere", "pakketilbud"],
      de: ["je mehr desto günstiger", "Bundle Angebot"],
      nl: ["hoe meer hoe voordeliger", "bundel korting"],
      fr: ["plus vous achetez plus vous économisez", "offre groupée"],
      es: ["cuantos más más ahorras", "pack ahorro"],
    },
  },
};
export const OFFER_IDS = Object.keys(OFFERS) as OfferId[];

/** "Find more": the offer's other phrases in the country's language. */
export function morePhrases(offer: OfferId, country: string): string[] {
  const lang = OFFER_COUNTRIES[country.toUpperCase()]?.lang ?? "en";
  return OFFERS[offer].more[lang].slice(0, 3);
}

/** Countries Offer Search covers, with the language their ads are written in. */
export const OFFER_COUNTRIES: Record<string, { name: string; lang: Lang }> = {
  DK: { name: "Denmark", lang: "da" },
  SE: { name: "Sweden", lang: "sv" },
  NO: { name: "Norway", lang: "no" },
  DE: { name: "Germany", lang: "de" },
  AT: { name: "Austria", lang: "de" },
  CH: { name: "Switzerland", lang: "de" },
  NL: { name: "Netherlands", lang: "nl" },
  BE: { name: "Belgium", lang: "nl" },
  FR: { name: "France", lang: "fr" },
  ES: { name: "Spain", lang: "es" },
  US: { name: "United States", lang: "en" },
  GB: { name: "United Kingdom", lang: "en" },
  IE: { name: "Ireland", lang: "en" },
  AU: { name: "Australia", lang: "en" },
  CA: { name: "Canada", lang: "en" },
  FI: { name: "Finland", lang: "en" },
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** An error's message without Convex's "Uncaught Error:" prefix, request id or stack, for showing in Admin. */
export function shortError(message: string, max = 200): string {
  return message
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/g, "")
    .replace(/^(Server Error\s*)?(Uncaught (Convex)?Error:\s*)?/, "")
    .replace(/\s+at\s+[\w.$<>]+\s*\([^)]*\)[\s\S]*$/, "")
    .replace(/\s+at\s+async[\s\S]*$/, "")
    .trim()
    .slice(0, max);
}

/**
 * What to type into the Ad Library: up to two of the offer's phrases in the country's language, each with
 * the user's extra words (a product or niche word in that language narrows it), or the user's own phrase.
 */
export function searchPhrases(input: { offer?: OfferId; country: string; extra?: string; custom?: string }): string[] {
  const extra = clean(input.extra ?? "").slice(0, 40);
  const custom = clean(input.custom ?? "").slice(0, 80);
  if (custom) return [clean(`${custom} ${extra}`)];
  const lang = OFFER_COUNTRIES[input.country.toUpperCase()]?.lang ?? "en";
  const offer = input.offer && OFFERS[input.offer] ? OFFERS[input.offer] : OFFERS.bxgy;
  return offer.phrases[lang].slice(0, 3).map((p) => clean(`${p} ${extra}`));
}

/** The daily free import (metaAdLibrary.ts): each offer's most common phrase in the country's language. */
export function dailyOfferPhrases(country: string): { offer: OfferId; phrase: string }[] {
  const lang = OFFER_COUNTRIES[country.toUpperCase()]?.lang ?? "en";
  return OFFER_IDS.map((offer) => ({ offer, phrase: OFFERS[offer].phrases[lang][0] }));
}

/** The cache key: the same search within a few hours is answered from the last one, for everyone. */
export function searchKey(country: string, phrases: string[]): string {
  return `${country.toUpperCase()}|${phrases.map((p) => p.toLowerCase()).sort().join("|")}`;
}

export function adLibrarySearchUrl(country: string, phrase: string): string {
  // Exact phrase: "keyword_unordered" let "2+1 gratis" match every ad that merely says "gratis".
  const p = new URLSearchParams({ active_status: "active", ad_type: "all", country: country.toUpperCase(), q: `"${phrase}"`, search_type: "keyword_exact_phrase", media_type: "all" });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

/** The daily offer research (Admin → Offer research): every offer's main phrase, one run per country. */
export function researchUrls(country: string): string[] {
  return dailyOfferPhrases(country).map((p) => adLibrarySearchUrl(country, p.phrase));
}

/** Ads per country for a day's research: the total shared out, at least the scraper's minimum of 10. */
export function researchAdsPerCountry(total: number, countries: number): number {
  if (!(countries > 0)) return 0;
  return Math.max(10, Math.ceil(Math.max(0, total) / countries));
}

/** One ad from the Ad Library, the parts Offer Search needs. */
export type SearchAd = {
  id: string;
  pageId?: string;
  pageName: string;
  link: string;
  headline: string;
  body: string;
  image?: string;
  startMs?: number;
  copies: number;
  /** EU/UK reach from the ad's details (Meta's DSA data); EU and UK searches only. */
  reach?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const get = (o: Json, ...keys: string[]): Json => {
  for (const k of keys) {
    let cur = o;
    for (const part of k.split(".")) cur = cur == null ? undefined : cur[part];
    if (cur !== undefined && cur !== null && cur !== "" && !(Array.isArray(cur) && cur.length === 0)) return cur;
  }
  return undefined;
};
const isTemplate = (s: unknown) => typeof s === "string" && /\{\{[^}]+\}\}/.test(s);

/** Strips Facebook's l.facebook.com redirect and fbclid from an ad's link. */
export function adLink(u: unknown): string {
  if (typeof u !== "string" || !u) return "";
  try {
    const url = new URL(u);
    if (/(^|\.)lm?\.facebook\.com$/.test(url.hostname) && url.searchParams.get("u")) return adLink(url.searchParams.get("u"));
    url.searchParams.delete("fbclid");
    return url.toString();
  } catch {
    return "";
  }
}

/** A row of the Apify Ad Library scraper's dataset as a SearchAd; null for error rows and ads without an id. */
export function toSearchAd(it: Json): SearchAd | null {
  const id = get(it, "ad_archive_id", "adArchiveID", "adArchiveId", "adId");
  if (!id) return null;
  const s = get(it, "snapshot") ?? {};
  const cards: Json[] = get(s, "cards") ?? [];
  let body: string = get(s, "body.text", "body.markup.__html") ?? (typeof s.body === "string" ? s.body : "") ?? "";
  if ((!body || isTemplate(body)) && cards[0]?.body) body = cards[0].body;
  if (isTemplate(body)) body = "";
  const pageName = String(get(it, "page_name", "pageName") ?? get(s, "page_name", "pageName") ?? "");
  const titles = [get(s, "title"), cards[0]?.title, get(s, "link_description")].filter((t) => typeof t === "string" && t.trim() && !isTemplate(t));
  const start = get(it, "start_date", "startDate");
  const startNum = typeof start === "number" ? start : /^\d+$/.test(String(start ?? "")) ? Number(start) : Date.parse(String(start ?? ""));
  return {
    id: String(id),
    ...(get(it, "page_id", "pageID", "pageId") ? { pageId: String(get(it, "page_id", "pageID", "pageId")) } : {}),
    pageName: pageName || "Unknown advertiser",
    link: adLink(get(s, "link_url", "linkUrl") ?? cards.find((c) => c?.link_url || c?.linkUrl)?.link_url ?? cards.find((c) => c?.linkUrl)?.linkUrl),
    headline: String(titles[0] ?? "").slice(0, 300),
    body: String(body ?? "").slice(0, 1500),
    ...(() => {
      const image =
        get(s, "images.0.original_image_url", "images.0.originalImageUrl", "images.0.resized_image_url", "images.0.resizedImageUrl") ??
        get(s, "videos.0.video_preview_image_url", "videos.0.videoPreviewImageUrl") ??
        get(s, "cards.0.original_image_url", "cards.0.originalImageUrl", "cards.0.video_preview_image_url", "cards.0.videoPreviewImageUrl");
      return image ? { image: String(image) } : {};
    })(),
    ...(Number.isFinite(startNum) && startNum > 0 ? { startMs: startNum < 1e12 ? startNum * 1000 : startNum } : {}),
    copies: Math.max(1, Number(get(it, "collation_count", "collationCount") ?? 1) || 1),
    ...(() => {
      const reach = Number(get(it, "aaa_info.eu_total_reach", "transparency_by_location.eu_transparency.eu_total_reach", "transparency_by_location.uk_transparency.total_reach", "eu_total_reach") ?? 0);
      return reach > 0 ? { reach } : {};
    })(),
  };
}

/** Hosts an ad can link to that aren't the advertiser's store. */
const NOT_A_STORE = /(^|\.)(facebook\.com|fb\.me|fb\.com|instagram\.com|messenger\.com|wa\.me|whatsapp\.com|youtube\.com|tiktok\.com|linktr\.ee|bit\.ly|google\.com|apple\.com|play\.google\.com)$/i;

export function storeHost(link: string): string | null {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    return host && !NOT_A_STORE.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** A product a store's ads link to, read from the Shopify store's /products/<handle>.json. */
export type FoundProduct = {
  handle: string;
  url: string;
  title: string;
  /** In the store's currency (FoundStore.currency). */
  price?: number;
  compareAt?: number;
  image?: string;
  /** The cheapest AliExpress picture match: its price in USD and how many times the store's price it is. */
  sourcing?: { price: number; url: string; title: string; markup: number };
};

export type FoundStore = {
  host: string;
  advertisers: string[];
  pageId?: string;
  /** Ads in this search (Meta's copies of an ad count once). */
  ads: number;
  /** Ad copies Meta grouped under these ads. */
  copies: number;
  /** Days the oldest of these ads has run. */
  oldestDays: number;
  /** The offers the ads promise, most common first. */
  offers: { label: string; count: number }[];
  productPaths: string[];
  sample: { id: string; headline: string; image?: string; days: number; offers: string[] }[];
  shopify?: boolean;
  /** EU/UK reach of these ads together (spend = reach ÷ 1,000 × CPM); missing outside the EU and UK. */
  reach?: number;
  /** From the store's /meta.json (Shopify): its currency and the country it's registered in. */
  currency?: string;
  storeCountry?: string;
  /** The products its ads link to, most linked first. */
  products?: FoundProduct[];
  /** Set where several countries' results are shown together (Admin → Offer research). */
  country?: string;
  /** Products in the store's catalogue (Shopify /products.json, counted up to 250); searches before store types. */
  productCount?: number;
  /** The store's published products (/meta.json), its product types, the share on sale and with ™ in the title. */
  catalogue?: number;
  productTypes?: number;
  onSaleShare?: number;
  tmShare?: number;
  /** A vendor left at Shopify's default name ("Mijn winkel", "My Store"): a store set up in a hurry. */
  defaultVendor?: boolean;
  /** Dropshipping apps seen on its home page (reviews imported from AliExpress, parcel tracking, sourcing apps). */
  apps?: string[];
  /** The ads counted for it (ids), so "Find more" doesn't count one twice. */
  adIds?: string[];
  /** How likely the store is a dropshipper (dropshipScore). */
  dropship?: Dropship;
};

export type StoreType = "hero" | "niche" | "general" | "brand";
/** `type` is missing on searches from before store types. */
export type Dropship = { score: number; likely: boolean; type?: StoreType; reasons: string[] };

// The offer kinds (lib/offerTags.ts) that count as each searched offer; "3 for 2" is the same deal as "2+1".
const OFFER_KINDS: Record<OfferId, OfferKind[]> = {
  bxgy: ["bxgy", "xfory"],
  percent: ["percent"],
  free_shipping: ["free_shipping"],
  free_gift: ["free_gift"],
  multibuy: ["xfory", "bxgy", "percent"],
};
const words = (t: string) => ` ${t.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}%+]+/gu, " ").trim()} `;

/** Whether an ad shows the offer searched for: its offer tags, or the searched words themselves. */
export function adShowsOffer(ad: Pick<SearchAd, "headline" | "body">, offer: OfferId | null, phrases: string[]): boolean {
  const text = `${ad.headline}
${ad.body}`;
  const kinds = offer ? OFFER_KINDS[offer] : [];
  if (kinds.length && offerTags(text).some((t) => kinds.includes(t.kind))) return true;
  const have = words(text);
  return phrases.some((p) => {
    const want = words(p);
    return want.trim() !== "" && have.includes(want);
  });
}

const URGENCY = new Set(["Ends today", "Ends soon", "Limited time"]);
const BIG_DISCOUNT = 0.3;
const ON_SALE = 0.6;
const TM_TITLES = 0.15;
// Catalogue limits: a hero store sells a handful of products, a niche store a few dozen of a few kinds.
const HERO = { products: 15, types: 3 };
const NICHE = { products: 80, types: 8 };

/** Apps (lib/storeInspect.ts names) that dropshippers use: reviews imported from AliExpress, tracking for slow parcels. */
export const DROPSHIP_APPS = new Set(["Loox", "Ali Reviews", "Parcel Panel", "Track123", "Trackpanda"]);
const SOURCING: [RegExp, string][] = [
  [/dsers/i, "DSers"],
  [/autods/i, "AutoDS"],
  [/cjdropshipping|cj-dropshipping/i, "CJ Dropshipping"],
  [/zendrop/i, "Zendrop"],
  [/sellthetrend|sell-the-trend/i, "Sell The Trend"],
  [/spocket/i, "Spocket"],
];
/** Apps that order from suppliers for the store. */
export const SOURCING_APPS = new Set(SOURCING.map(([, name]) => name));

/** The supplier-ordering apps a store's page code mentions. */
export function sourcingAppsIn(html: string): string[] {
  return SOURCING.filter(([re]) => re.test(html)).map(([, name]) => name);
}

const DEFAULT_VENDORS = new Set(["mijn winkel", "my store", "mein shop", "ma boutique", "mi tienda", "min butik", "min butikk"]);
export const isDefaultVendor = (vendor: string) => DEFAULT_VENDORS.has(vendor.trim().toLowerCase());

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What kind of store this is, from what could be read: a hero store (a handful of products), a niche dropship store
 * (a few dozen of a few kinds), a general store, or a brand/retailer. Big brands and non-Shopify stores are brands.
 * Evidence points: most products on sale, dropship apps (sourcing apps count double), ™ titles, a default vendor,
 * urgency in its ads, a big discount on its main product, an AliExpress match.
 */
export function storeType(s: FoundStore): Dropship {
  if (bigBrandIn(`${s.host} ${s.advertisers.join(" ")}`)) return { score: 0, likely: false, type: "brand", reasons: ["Big brand"] };
  if (!s.shopify) return { score: 0, likely: false, type: "brand", reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  const size = s.catalogue ?? s.productCount;
  if (size !== undefined && size > 0) reasons.push(plural(size, "product"));
  if (s.productTypes) reasons.push(plural(s.productTypes, "type"));
  if ((s.onSaleShare ?? 0) >= ON_SALE) {
    score += 1;
    reasons.push(`${Math.round((s.onSaleShare ?? 0) * 100)}% on sale`);
  }
  const apps = (s.apps ?? []).filter((a) => DROPSHIP_APPS.has(a) || SOURCING_APPS.has(a));
  if (apps.some((a) => DROPSHIP_APPS.has(a))) score += 1;
  if (apps.some((a) => SOURCING_APPS.has(a))) score += 2;
  if (apps.length) reasons.push(apps.join(", "));
  if ((s.tmShare ?? 0) >= TM_TITLES) {
    score += 1;
    reasons.push("™ titles");
  }
  if (s.defaultVendor) {
    score += 1;
    reasons.push("default vendor");
  }
  if (s.offers.some((o) => URGENCY.has(o.label))) {
    score += 1;
    reasons.push("Urgency ads");
  }
  const off = Math.max(0, ...(s.products ?? []).map((p) => (p.compareAt && p.price !== undefined && p.compareAt > p.price ? (p.compareAt - p.price) / p.compareAt : 0)));
  if (off >= BIG_DISCOUNT) {
    score += 1;
    reasons.push(`−${Math.round(off * 100)}%`);
  }
  const match = (s.products ?? []).find((p) => p.sourcing)?.sourcing;
  if (match) {
    score += 1;
    reasons.push(`On AliExpress ×${match.markup}`);
  }
  const types = s.productTypes ?? 0;
  const type: StoreType =
    size !== undefined && size <= HERO.products && types <= HERO.types && score >= 1
      ? "hero"
      : size !== undefined && size <= NICHE.products && types <= NICHE.types && score >= 2
        ? "niche"
        : score >= 3
          ? "general"
          : "brand";
  return { score, likely: type !== "brand", type, reasons };
}

/** A product title as words to search Meta for: before "|", " - ", " – ", ":" or "(", without ™/® and the store's brand. */
export function shortProductName(title: string, brand?: string): string {
  let t = title.replace(/[™®]/g, " ").split(/\s[|\-–:]\s|\(|\|/)[0];
  if (brand) t = t.replace(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  return t.replace(/[,.!]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
}

const MAX_AD_IDS = 200;

/** Offer Search's automatic AliExpress matches a day, for all users (OFFER_PICTURES_PER_DAY, default 100). */
export const offerPictureLimit = () => Math.max(0, Number(process.env.OFFER_PICTURES_PER_DAY ?? 100) || 0);

/** The supplier listing to compare against: the one most people buy, else the middle price of the 3 cheapest
 * (the cheapest alone is often a near-miss). */
export function bestSupplierMatch(matches: PictureMatch[]): PictureMatch | undefined {
  const bought = matches.filter((m) => m.orders);
  if (bought.length) return bought.reduce((a, b) => ((b.orders ?? 0) > (a.orders ?? 0) ? b : a));
  const cheapest = [...matches].sort((a, b) => a.price - b.price).slice(0, 3);
  return cheapest[Math.floor((cheapest.length - 1) / 2)];
}

const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", da: "Danish", sv: "Swedish", no: "Norwegian", de: "German", nl: "Dutch", fr: "French", es: "Spanish" };
/** The language a country's Offer Search uses, by name ("German"), or undefined for a country we don't search. */
export function searchLanguage(country: string): string | undefined {
  const c = OFFER_COUNTRIES[country.toUpperCase()];
  return c ? LANGUAGE_NAMES[c.lang] : undefined;
}

/** A "Find more" run's stores added to the first run's: counts added up for stores found twice, new ones after. */
export function mergeStores(first: FoundStore[], more: FoundStore[], max = 80): FoundStore[] {
  const out = first.map((s) => ({ ...s, offers: [...s.offers.map((o) => ({ ...o }))] }));
  const byHost = new Map(out.map((s) => [s.host, s]));
  for (const m of more) {
    const s = byHost.get(m.host);
    if (!s) {
      out.push(m);
      byHost.set(m.host, m);
      continue;
    }
    s.ads += m.ads;
    s.copies += m.copies;
    if (m.adIds) s.adIds = [...(s.adIds ?? []), ...m.adIds].slice(0, MAX_AD_IDS);
    s.oldestDays = Math.max(s.oldestDays, m.oldestDays);
    if (m.reach) s.reach = (s.reach ?? 0) + m.reach;
    for (const o of m.offers) {
      const have = s.offers.find((x) => x.label === o.label);
      if (have) have.count += o.count;
      else s.offers.push({ ...o });
    }
    s.offers.sort((a, b) => b.count - a.count);
  }
  return out.slice(0, max);
}

/** "/collections/x/products/seat-cover/" → "seat-cover"; null for links that aren't to a product. */
export function productHandle(path: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** A Shopify store's /meta.json: null when it isn't one (the Shopify check). `products` is its published count. */
export function readShopMeta(json: unknown): { currency?: string; country?: string; products?: number } | null {
  const m = (json ?? {}) as { myshopify_domain?: unknown; currency?: unknown; country?: unknown; published_products_count?: unknown };
  if (typeof m.myshopify_domain !== "string" || !m.myshopify_domain) return null;
  const count = m.published_products_count;
  return {
    ...(typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) ? { currency: m.currency } : {}),
    ...(typeof m.country === "string" && /^[A-Z]{2}$/.test(m.country) ? { country: m.country } : {}),
    ...(typeof count === "number" && Number.isFinite(count) && count >= 0 ? { products: count } : {}),
  };
}

const share = (n: number, of: number) => Math.round((n / of) * 100) / 100;

/** What a store's /products.json says about it: product types, the share on sale (first variant), ™ titles, a default vendor. */
export function catalogueSignals(products: unknown): Pick<FoundStore, "productTypes" | "onSaleShare" | "tmShare" | "defaultVendor"> {
  if (!Array.isArray(products) || !products.length) return {};
  const list = products as { product_type?: unknown; title?: unknown; vendor?: unknown; variants?: { price?: unknown; compare_at_price?: unknown }[] }[];
  const types = new Set(list.map((p) => (typeof p.product_type === "string" ? p.product_type.trim().toLowerCase() : "")).filter(Boolean));
  const onSale = list.filter((p) => {
    const v = Array.isArray(p.variants) ? p.variants[0] : undefined;
    const price = Number(v?.price);
    return price > 0 && Number(v?.compare_at_price) > price;
  }).length;
  const tm = list.filter((p) => typeof p.title === "string" && /[™®]/.test(p.title)).length;
  return {
    productTypes: types.size,
    onSaleShare: share(onSale, list.length),
    tmShare: share(tm, list.length),
    ...(list.some((p) => typeof p.vendor === "string" && isDefaultVendor(p.vendor)) ? { defaultVendor: true } : {}),
  };
}

/** A Shopify /products/<handle>.json as a FoundProduct (first variant's price); null when it isn't a product. */
export function readShopifyProduct(json: unknown, host: string, handle: string): FoundProduct | null {
  const p = ((json ?? {}) as { product?: Json }).product;
  if (!p || typeof p.title !== "string" || !p.title.trim()) return null;
  const v = Array.isArray(p.variants) ? p.variants[0] : undefined;
  const price = Number(v?.price);
  const compareAt = Number(v?.compare_at_price);
  const src = p.image?.src ?? (Array.isArray(p.images) ? p.images[0]?.src : undefined);
  const image = typeof src === "string" ? (src.startsWith("//") ? `https:${src}` : src) : "";
  return {
    handle,
    url: `https://${host}/products/${encodeURIComponent(handle)}`,
    title: p.title.trim().slice(0, 200),
    ...(price > 0 ? { price } : {}),
    ...(compareAt > price && price > 0 ? { compareAt } : {}),
    ...(/^https:\/\//.test(image) ? { image } : {}),
  };
}

export type StoreSort = "ads" | "days" | "reach" | "dropship";
export type StoreFilter = { shopifyOnly?: boolean; likelyOnly?: boolean; type?: StoreType; minAds?: number; minDays?: number; country?: string; sort?: StoreSort };

// Likely dropshippers first: hero, niche, general (and likely ones from before store types), then the rest.
const TYPE_ORDER: Record<StoreType, number> = { hero: 0, niche: 1, general: 2, brand: 4 };
const typeRank = (s: FoundStore) => (s.dropship?.type ? TYPE_ORDER[s.dropship.type] : s.dropship?.likely ? 3 : 4);

/** The page's filters and sorting over a search's stores (Offer Search and Admin → Offer research). */
export function filterStores(stores: FoundStore[], f: StoreFilter): FoundStore[] {
  const out = stores.filter(
    (s) => (!f.shopifyOnly || s.shopify) && (!f.likelyOnly || s.dropship?.likely) && (!f.type || s.dropship?.type === f.type) && s.ads >= (f.minAds ?? 0) && s.oldestDays >= (f.minDays ?? 0) && (!f.country || s.country === f.country),
  );
  if (f.sort === "dropship") return out.sort((a, b) => typeRank(a) - typeRank(b) || (b.reach ?? 0) - (a.reach ?? 0) || b.ads - a.ads);
  if (f.sort === "days") return out.sort((a, b) => b.oldestDays - a.oldestDays || b.ads - a.ads);
  if (f.sort === "reach") return out.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || b.ads - a.ads);
  return out.sort((a, b) => b.ads - a.ads || b.copies - a.copies || b.oldestDays - a.oldestDays);
}

/** The ads grouped by the store they link to, busiest first: most ads, then longest running. */
export function groupByStore(ads: SearchAd[], now = Date.now()): FoundStore[] {
  const groups = new Map<string, { ads: SearchAd[] }>();
  const seen = new Set<string>();
  for (const ad of ads) {
    if (seen.has(ad.id)) continue;
    seen.add(ad.id);
    const host = storeHost(ad.link);
    if (!host) continue;
    const g = groups.get(host) ?? { ads: [] };
    g.ads.push(ad);
    groups.set(host, g);
  }
  const days = (ad: SearchAd) => (ad.startMs ? Math.max(0, Math.floor((now - ad.startMs) / 86_400_000)) : 0);
  const stores: FoundStore[] = [...groups.entries()].map(([host, g]) => {
    const offerCount = new Map<string, number>();
    const sample = g.ads
      .map((ad) => ({ ad, days: days(ad), offers: [...new Set(offerTags(`${ad.headline}\n${ad.body}`).map((t) => t.label))] }))
      .sort((a, b) => b.days - a.days);
    for (const x of sample) for (const o of x.offers) offerCount.set(o, (offerCount.get(o) ?? 0) + 1);
    // Product links, most linked first, as /products/<handle> whatever collection they went through.
    const paths = new Map<string, number>();
    for (const ad of g.ads) {
      try {
        const handle = productHandle(new URL(ad.link).pathname);
        if (handle) paths.set(`/products/${handle}`, (paths.get(`/products/${handle}`) ?? 0) + 1);
      } catch {
        // not a URL
      }
    }
    const reach = g.ads.reduce((n, a) => n + (a.reach ?? 0), 0);
    return {
      host,
      advertisers: [...new Set(g.ads.map((a) => a.pageName))].slice(0, 3),
      ...(g.ads.find((a) => a.pageId)?.pageId ? { pageId: g.ads.find((a) => a.pageId)!.pageId } : {}),
      ads: g.ads.length,
      adIds: g.ads.map((a) => a.id).slice(0, MAX_AD_IDS),
      copies: g.ads.reduce((n, a) => n + a.copies, 0),
      oldestDays: sample[0]?.days ?? 0,
      offers: [...offerCount.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      productPaths: [...paths.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 5),
      ...(reach > 0 ? { reach } : {}),
      sample: sample.slice(0, 3).map((x) => ({ id: x.ad.id, headline: x.ad.headline || x.ad.body.split("\n")[0].slice(0, 120), ...(x.ad.image ? { image: x.ad.image } : {}), days: x.days, offers: x.offers.slice(0, 3) })),
    };
  });
  return stores.sort((a, b) => b.ads - a.ads || b.copies - a.copies || b.oldestDays - a.oldestDays);
}
