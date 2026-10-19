// JustOne API answers (api.justoneapi.com, convex/justone.ts) read into what the product page and the TikTok Shop page show.
// Pure: no fetch here. Shapes were read from live answers in October 2026.

import { searchKeywords } from "./aliexpress";
import { parseAmount } from "./priceParse";

/** What a product page looks up (convex/justone.ts marketsFor); Amazon once per marketplace. */
export type MarketKind = "aliexpress" | "amazon" | "tiktok" | "tiktokShop";
export const MARKET_KINDS: MarketKind[] = ["aliexpress", "amazon", "tiktok", "tiktokShop"];

/** A product's lookups are kept this long, or a day after a failed one. */
export const MARKET_REFRESH_DAYS = 7;
export const MARKET_RETRY_DAYS = 1;

/** Live TikTok Shop searches per user per day (TikTok Shop page → Search TikTok Shop), by tier (lib/billing.ts byTier). */
export const TIKTOK_SHOP_SEARCHES = { admin: 200, paid: 30, trial: 5, free: 2 } as const;
/** Regions JustOne's TikTok Shop search answers for (it refuses the UK and EU). */
export const TIKTOK_SHOP_REGIONS = ["US", "MX", "BR", "JP", "SG", "MY", "PH", "TH", "VN", "ID"] as const;

export const AMAZON_COUNTRIES = ["US", "AU", "BR", "CA", "FR", "DE", "IN", "IT", "MX", "NL", "SG", "ES", "TR", "AE", "GB", "JP", "SA", "PL", "SE", "BE", "EG", "ZA", "IE"] as const;
// Countries without their own Amazon go to the one their shoppers use.
const AMAZON_NEAREST: Record<string, string> = { DK: "DE", AT: "DE", CH: "DE", LU: "DE", CZ: "DE", HU: "DE", NO: "SE", FI: "SE", PT: "ES", SK: "PL", GR: "IT", NZ: "AU", QA: "AE", KW: "AE", BH: "AE", OM: "AE" };

/** The Amazon marketplace for the user's target country; Germany when unknown. */
export function amazonMarket(country: string | null | undefined): string {
  const c = (country ?? "").toUpperCase();
  if ((AMAZON_COUNTRIES as readonly string[]).includes(c)) return c;
  return AMAZON_NEAREST[c] ?? "DE";
}

/** A short search phrase from a product title: marketplaces and TikTok match fewer words better. */
export function shortKeywords(title: string, words = 4): string {
  return searchKeywords(title).split(" ").slice(0, words).join(" ");
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const https = (u: string | undefined) => (u?.startsWith("//") ? `https:${u}` : u);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type AliSeller = { id: string; title: string; url: string; image?: string; priceUsd?: number; sold?: number; rating?: number };

/** /api/aliexpress/search-products/v1 (sort salesDesc, currency USD): best sellers first. */
export function aliexpressBySales(body: unknown): { items: AliSeller[]; total?: number } {
  const result = obj(obj(body).result);
  const items = arr(result.resultList).flatMap((row): AliSeller[] => {
    const it = obj(obj(row).item);
    const id = str(it.itemId);
    const title = str(it.title);
    if (!id || !title) return [];
    const def = obj(obj(it.sku).def);
    return [{
      id,
      title,
      url: https(str(it.itemUrl)) ?? `https://www.aliexpress.com/item/${id}.html`,
      image: https(str(it.image)),
      priceUsd: num(def.promotionPrice) ?? num(def.price),
      sold: num(it.sales),
      rating: num(it.averageStarRate) || undefined,
    }];
  });
  return { items, total: num(obj(result.base).totalResults) };
}

export type AmazonItem = {
  asin: string;
  title: string;
  url: string;
  image?: string;
  /** As Amazon shows it ("27,50 €"), and as a number in `currency`. */
  priceText?: string;
  price?: number;
  currency?: string;
  ratings?: number;
  stars?: number;
  /** "100+ bought in past month" → 100. */
  boughtLastMonth?: number;
  bestSeller?: boolean;
  amazonChoice?: boolean;
};

/** "100+ Mal im letzten Monat gekauft", "1K+ bought in past month", "2.000+ …" → 100, 1000, 2000. */
export function boughtLastMonth(text: string | undefined): number | undefined {
  const m = text?.match(/(\d+(?:[.,]\d+)?)\s*([KkMm]|mil|tsd\.?)?\s*\+/);
  if (!m) return undefined;
  const unit = m[2]?.toLowerCase();
  const big = unit === "k" || unit === "mil" || unit?.startsWith("tsd") ? 1000 : unit === "m" ? 1_000_000 : 1;
  // "2.000" and "2,000" are thousands separators unless a unit follows ("1.5K").
  const n = big === 1 ? Number(m[1].replace(/[.,]/g, "")) : Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * big) : undefined;
}

/** /api/amazon/search-products/v1. */
export function amazonResults(body: unknown): { items: AmazonItem[]; total?: number; domain?: string } {
  const b = obj(body);
  const items = arr(b.products).flatMap((row): AmazonItem[] => {
    const p = obj(row);
    const asin = str(p.asin);
    const title = str(p.product_title);
    if (!asin || !title) return [];
    const priceText = str(p.product_price);
    return [{
      asin,
      title,
      url: str(p.product_url) ?? `https://${str(b.domain) ?? "www.amazon.com"}/dp/${asin}`,
      image: str(p.product_photo),
      priceText,
      price: priceText ? parseAmount(priceText) : undefined,
      currency: str(p.currency),
      ratings: num(p.product_num_ratings),
      stars: num(p.product_star_rating),
      boughtLastMonth: boughtLastMonth(str(p.sales_volume)),
      bestSeller: p.is_best_seller === true || undefined,
      amazonChoice: p.is_amazon_choice === true || undefined,
    }];
  });
  return { items, total: num(b.total_products), domain: str(b.domain) };
}

export type TikTokVideo = { id: string; url: string; text?: string; author?: string; cover?: string; likes?: number; plays?: number; shares?: number; createdAt?: string };

/** /api/tiktok/search-post/v1 (sortType MOST_LIKED): most liked first. */
export function tiktokVideos(body: unknown): TikTokVideo[] {
  return arr(obj(body).search_item_list).flatMap((row): TikTokVideo[] => {
    const a = obj(obj(row).aweme_info);
    const id = str(a.aweme_id);
    if (!id) return [];
    const author = obj(a.author);
    const stats = obj(a.statistics);
    const created = num(a.create_time);
    const handle = str(author.unique_id);
    return [{
      id,
      url: str(a.share_url)?.split("?")[0] ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : `https://www.tiktok.com/video/${id}`),
      text: str(a.desc),
      author: handle,
      cover: str(arr(obj(obj(a.video).cover).url_list)[0]),
      likes: num(stats.digg_count),
      plays: num(stats.play_count),
      shares: num(stats.share_count),
      createdAt: created ? new Date(created * 1000).toISOString() : undefined,
    }];
  });
}

export type TikTokShopItem = { id: string; title: string; url: string; image?: string; price?: number; currency?: string; sold?: number; rating?: number; reviews?: number; shop?: string };

/** /api/tiktok-shop/search-products/v1. An unsupported region answers with `region_supported: false` and no products. */
export function tiktokShopProducts(body: unknown): { items: TikTokShopItem[]; unsupported?: boolean } {
  const outer = obj(body);
  const data = outer.products ? outer : obj(outer.data);
  if (outer.region_supported === false || data.region_supported === false) return { items: [], unsupported: true };
  const items = arr(data.products).flatMap((row): TikTokShopItem[] => {
    const p = obj(row);
    const id = str(p.product_id);
    const title = str(p.title);
    if (!id || !title) return [];
    const priceInfo = obj(p.product_price_info);
    const rate = obj(p.rate_info);
    return [{
      id,
      title,
      url: str(obj(p.seo_url).canonical_url) ?? `https://shop.tiktok.com/view/product/${id}`,
      image: str(arr(obj(p.image).url_list)[0]),
      price: num(priceInfo.sale_price_decimal),
      currency: str(priceInfo.currency_name),
      sold: num(obj(p.sold_info).sold_count),
      rating: num(rate.score) || undefined,
      reviews: num(rate.review_count),
      shop: str(obj(p.seller_info).shop_name),
    }];
  });
  return { items };
}

/** A product's saved lookup; `failed` keeps the last good items. */
export type MarketEntry<T> = { at: string; items: T[]; total?: number; country?: string; failed?: boolean };
export type ProductMarkets = {
  aliexpress?: MarketEntry<AliSeller>;
  tiktok?: MarketEntry<TikTokVideo>;
  tiktokShop?: MarketEntry<TikTokShopItem>;
  /** Per Amazon marketplace ("DE", "SE"…). */
  amazon?: Record<string, MarketEntry<AmazonItem>>;
};

/** The key a lookup is claimed and counted under: Amazon per marketplace. */
export const marketKey = (kind: MarketKind, amazonCountry: string) => (kind === "amazon" ? `amazon:${amazonCountry}` : kind);

/** Whether a lookup is due: never looked up, older than a week, or a failed one older than a day. */
export function marketDue(checkedAt: string | undefined, failed: boolean | undefined, now: number): boolean {
  if (!checkedAt) return true;
  const days = failed ? MARKET_RETRY_DAYS : MARKET_REFRESH_DAYS;
  return now - Date.parse(checkedAt) > days * 86_400_000;
}
