// Offer Search: find the stores advertising an offer ("Buy 2 get 1", "50% off", "Free shipping") in a
// country right now. The offer is searched in Meta's public Ad Library in the country's own language
// (convex/offerSearch.ts runs it through Apify), and the active ads that come back are grouped by the
// store they link to, with their offer chips (lib/offerTags.ts). Pure and unit tested.

import { offerTags } from "./offerTags";

export type OfferId = "bxgy" | "percent" | "free_shipping" | "free_gift" | "multibuy";
export type Lang = "en" | "da" | "sv" | "no" | "de" | "nl" | "fr" | "es";

/** The offers to pick from, and the words people use for them in each language (most common first). */
export const OFFERS: Record<OfferId, { label: string; phrases: Record<Lang, string[]> }> = {
  bxgy: {
    label: "Buy 2 get 1",
    phrases: {
      en: ["buy 2 get 1 free", "buy 1 get 1 free"],
      da: ["køb 2 få 1 gratis", "køb 1 få 1 gratis"],
      sv: ["köp 2 få 1 gratis", "köp 1 få 1 gratis"],
      no: ["kjøp 2 få 1 gratis", "kjøp 1 få 1 gratis"],
      de: ["kaufe 2 erhalte 1 gratis", "1+1 gratis"],
      nl: ["2+1 gratis", "1+1 gratis"],
      fr: ["1 acheté 1 offert", "2 achetés 1 offert"],
      es: ["compra 2 llévate 3", "2x1"],
    },
  },
  percent: {
    label: "% off",
    phrases: {
      en: ["50% off", "40% off"],
      da: ["50% rabat", "40% rabat"],
      sv: ["50% rabatt", "40% rabatt"],
      no: ["50% rabatt", "40% rabatt"],
      de: ["50% Rabatt", "40% Rabatt"],
      nl: ["50% korting", "40% korting"],
      fr: ["-50%", "50% de réduction"],
      es: ["50% de descuento", "40% de descuento"],
    },
  },
  free_shipping: {
    label: "Free shipping",
    phrases: {
      en: ["free shipping"],
      da: ["gratis fragt", "gratis levering"],
      sv: ["fri frakt"],
      no: ["gratis frakt"],
      de: ["kostenloser Versand", "gratis Versand"],
      nl: ["gratis verzending"],
      fr: ["livraison gratuite"],
      es: ["envío gratis"],
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
  },
};
export const OFFER_IDS = Object.keys(OFFERS) as OfferId[];

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
  return offer.phrases[lang].slice(0, 2).map((p) => clean(`${p} ${extra}`));
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
  const p = new URLSearchParams({ active_status: "active", ad_type: "all", country: country.toUpperCase(), q: phrase, search_type: "keyword_unordered", media_type: "all" });
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
};

/** "/collections/x/products/seat-cover/" → "seat-cover"; null for links that aren't to a product. */
export function productHandle(path: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** A Shopify store's /meta.json: null when it isn't one (the Shopify check). */
export function readShopMeta(json: unknown): { currency?: string; country?: string } | null {
  const m = (json ?? {}) as { myshopify_domain?: unknown; currency?: unknown; country?: unknown };
  if (typeof m.myshopify_domain !== "string" || !m.myshopify_domain) return null;
  return {
    ...(typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) ? { currency: m.currency } : {}),
    ...(typeof m.country === "string" && /^[A-Z]{2}$/.test(m.country) ? { country: m.country } : {}),
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

export type StoreSort = "ads" | "days" | "reach";
export type StoreFilter = { shopifyOnly?: boolean; minAds?: number; minDays?: number; country?: string; sort?: StoreSort };

/** The page's filters and sorting over a search's stores (Offer Search and Admin → Offer research). */
export function filterStores(stores: FoundStore[], f: StoreFilter): FoundStore[] {
  const out = stores.filter(
    (s) => (!f.shopifyOnly || s.shopify) && s.ads >= (f.minAds ?? 0) && s.oldestDays >= (f.minDays ?? 0) && (!f.country || s.country === f.country),
  );
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
