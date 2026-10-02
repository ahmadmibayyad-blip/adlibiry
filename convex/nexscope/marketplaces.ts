// Nexscope.ai → products from TikTok Shop and from Shopify stores (besides
// Amazon, see client.ts). Pure mappers, so they can be tested directly; the
// calls are made by productDiscovery.ts.
// Docs: https://github.com/nexscope-ai/nexscope-ecommerce-api
//   docs/data/tiktok-top-selling-products.md (FastMoss rankings)
//   docs/data/shopify-product-query.md      (store products, Facebook ads)
// Every number shown comes from the reply; nothing is made up.

import { classifyNiche } from "../lib/category";

export const nexscopeSkillUrl = (skill: string) => `https://api.nexscope.ai/api/skill-api/v1/skills/${skill}/run`;

export type TikTokShopProduct = {
  productId?: string;
  title?: string;
  price?: number;
  currency?: string;
  totalSaleCnt?: number;
  totalSale1dCnt?: number;
  totalSale7dCnt?: number;
  growthRate?: number; // percent
  shopName?: string;
  categoryName?: string;
  imageUrl?: string;
  offShelvesText?: string;
};

export type ShopifyProduct = {
  productId?: string;
  title?: string;
  productLink?: string;
  previewImageUrl?: string;
  minPrice?: string | number;
  storeLink?: string;
  competitorCount?: string | number;
  facebookAdCount?: string | number;
  weekOrderCount?: string | number;
  weekRevenueGrowth?: string | number; // percent
  isDeleted?: string | number;
};

// What upsertDiscovered needs for one product.
export type Discovered = {
  externalId: string;
  title: string;
  price?: number;
  originalPrice?: string;
  imageUrl: string;
  supplierUrl: string;
  storeUrl?: string;
  category: string;
  aiScore: number;
  trend: string;
  description: string;
  tags: string[];
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
// 0..1 on a log scale, 1 at `full`.
const logShare = (n: number | undefined, full: number) => Math.min(1, Math.log10(Math.max(0, n ?? 0) + 1) / Math.log10(full + 1));
const growthShare = (pct: number | undefined) => (pct === undefined ? 0.5 : Math.max(0, Math.min(1, (pct + 50) / 150)));
const clampScore = (s: number) => Math.max(1, Math.min(100, Math.round(s)));

export function trendFromGrowthPercent(pct: number | undefined): string {
  if (pct === undefined) return "Unknown";
  if (pct >= 15) return "Rising";
  if (pct >= -5) return "Stable";
  return "Declining";
}

// TikTok Shop's own category names → AdSpy Pro niches (first match wins).
const TIKTOK_CATEGORIES: [RegExp, string][] = [
  [/beauty|personal care|makeup|skin/i, "Beauty"],
  [/pet/i, "Pet Supplies"],
  [/jewel/i, "Jewelry"],
  [/baby|kids|maternity/i, "Baby & Kids"],
  [/toy|hobb/i, "Toys"],
  [/auto|motor|vehicle/i, "Automotive"],
  [/sport|outdoor|fitness/i, "Sports"],
  [/health/i, "Health & Wellness"],
  [/phone|electronic|computer|office equipment/i, "Electronics"],
  [/home|kitchen|household|furniture|tools|garden/i, "Home & Living"],
  [/wear|fashion|shoe|luggage|bag|accessor|underwear/i, "Fashion"],
];

export function nicheFromTikTokCategory(name: string | undefined): string | undefined {
  return name ? TIKTOK_CATEGORIES.find(([re]) => re.test(name))?.[1] : undefined;
}

export function fromTikTokShop(p: TikTokShopProduct): Discovered | null {
  if (!p.productId || !p.title || !p.imageUrl || p.offShelvesText === "Yes") return null;
  const usd = !p.currency || p.currency.toUpperCase() === "USD";
  const units = p.totalSale1dCnt ?? p.totalSale7dCnt;
  const category = classifyNiche({ title: p.title }, nicheFromTikTokCategory(p.categoryName));
  const sold = p.totalSaleCnt ? `${p.totalSaleCnt.toLocaleString("en-US")} sold in total` : "";
  return {
    externalId: `tts_${p.productId}`,
    title: p.title,
    price: usd && p.price && p.price > 0 ? Math.round(p.price * 100) / 100 : undefined,
    originalPrice: !usd && p.price ? `${p.price} ${p.currency}` : undefined,
    imageUrl: p.imageUrl,
    supplierUrl: `https://shop.tiktok.com/view/product/${p.productId}?region=US`,
    category,
    aiScore: clampScore(50 * logShare(units, 5_000) + 30 * logShare(p.totalSaleCnt, 500_000) + 20 * growthShare(p.growthRate)),
    trend: trendFromGrowthPercent(p.growthRate),
    description: [`TikTok Shop best-seller${p.shopName ? ` from ${p.shopName}` : ""}`, units ? `${units.toLocaleString("en-US")} sold in the latest day` : "", sold]
      .filter(Boolean)
      .join(" · ") + ".",
    tags: [category, "TikTok Shop", "market data"],
  };
}

// Field names vary between Nexscope's docs and live replies; accept the
// common spellings (camelCase and snake_case).
function pick(p: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export function normalizeShopify(raw: Record<string, unknown>): ShopifyProduct {
  const domain = pick(raw, "storeDomain", "store_domain", "domain", "shopDomain");
  const handle = pick(raw, "handle", "productHandle", "product_handle");
  const storeLink = pick(raw, "storeLink", "store_link", "storeUrl", "store_url", "shopUrl") ?? (domain ? `https://${domain.replace(/^https?:\/\//, "")}` : undefined);
  return {
    productId: pick(raw, "productId", "product_id", "id"),
    title: pick(raw, "title", "productTitle", "product_title", "name"),
    productLink:
      pick(raw, "productLink", "product_link", "productUrl", "product_url", "url", "link") ??
      (storeLink && handle ? `${storeLink.replace(/\/$/, "")}/products/${handle}` : storeLink),
    previewImageUrl: pick(raw, "previewImageUrl", "preview_image_url", "imageUrl", "image_url", "image", "mainImage", "img"),
    minPrice: pick(raw, "minPrice", "min_price", "price"),
    storeLink,
    competitorCount: pick(raw, "competitorCount", "competitor_count"),
    facebookAdCount: pick(raw, "facebookAdCount", "facebook_ad_count", "adCount", "ad_count"),
    weekOrderCount: pick(raw, "weekOrderCount", "week_order_count", "weeklyOrders"),
    weekRevenueGrowth: pick(raw, "weekRevenueGrowth", "week_revenue_growth"),
    isDeleted: pick(raw, "isDeleted", "is_deleted"),
  };
}

export function fromShopify(p: ShopifyProduct, fallbackNiche: string): Discovered | null {
  if (!p.productId || !p.title || !p.productLink || String(p.isDeleted ?? "0") === "1") return null;
  const price = num(p.minPrice);
  const orders = num(p.weekOrderCount);
  const ads = num(p.facebookAdCount);
  const growth = num(p.weekRevenueGrowth);
  const stores = num(p.competitorCount);
  const category = classifyNiche({ title: p.title, url: p.productLink }, fallbackNiche);
  return {
    externalId: `shopify_${p.productId}`,
    title: p.title,
    price: price && price > 0 ? Math.round(price * 100) / 100 : undefined,
    imageUrl: p.previewImageUrl ?? "",
    supplierUrl: p.productLink,
    storeUrl: p.productLink,
    category,
    aiScore: clampScore(45 * logShare(orders, 2_000) + 35 * logShare(ads, 200) + 20 * growthShare(growth)),
    trend: trendFromGrowthPercent(growth),
    description:
      [
        "Shopify store product running Facebook ads",
        orders !== undefined ? `${orders.toLocaleString("en-US")} orders last week (est.)` : "",
        ads ? `${ads} Facebook ad${ads === 1 ? "" : "s"}` : "",
        stores ? `sold by ${stores} store${stores === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" · ") + ".",
    tags: [category, "Shopify", "Facebook ads"],
  };
}

// The store a Shopify product belongs to, for the Stores tracker. Keyed like
// the store import (tiktokAds.ts importShopifyStores) so both update one row.
export type DiscoveredStore = {
  externalId: string;
  name: string;
  url: string;
  logoUrl: string;
  niche: string;
  activeAdsCount: number;
  bestSeller: { title: string; imageUrl: string; price: number; estSalesRange: string };
};

export function storeFromShopify(
  p: ShopifyProduct,
  product: Pick<Discovered, "title" | "imageUrl" | "price" | "supplierUrl" | "category">,
): DiscoveredStore | null {
  let host: string;
  try {
    host = new URL(p.storeLink || product.supplierUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domain = host.replace(/^www\./, "");
  const orders = num(p.weekOrderCount);
  return {
    externalId: `shopify:${domain}`,
    name: domain,
    url: `https://${domain}`,
    logoUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    niche: product.category,
    activeAdsCount: Math.round(num(p.facebookAdCount) ?? 0),
    bestSeller: {
      title: product.title,
      imageUrl: product.imageUrl,
      price: product.price ?? 0,
      estSalesRange: orders !== undefined ? `~${orders.toLocaleString("en-US")} orders/week` : "Unknown",
    },
  };
}
