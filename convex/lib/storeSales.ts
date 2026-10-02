// Store sales tracking: pure helpers (convex/storeSales.ts runs them).
//
// Shopify stores publish their catalog at /products.json. Shopify bumps a
// product's updated_at when its stock changes, so products updated since the
// last check are a sign of sales. Owners editing products also bump it, so
// every number here is a range, never an exact count.

export type ShopifyProduct = {
  title?: string;
  handle?: string;
  created_at?: string;
  updated_at?: string;
  variants?: { price?: string | number; updated_at?: string }[];
  images?: { src?: string }[];
};

export type SellingProduct = { title: string; url: string; imageUrl: string; price: number; updatedAt: string };

export type CatalogSummary = {
  productCount: number;
  updatedCount: number; // products changed in the window
  newCount: number; // products created in the window
  avgPrice: number; // average price of the changed products (all products if none changed)
  estOrdersLow: number;
  estOrdersHigh: number;
  estRevenueLow: number;
  estRevenueHigh: number;
  topProducts: SellingProduct[];
};

// Each changed product ≈ 1–3 orders in the window.
export const ORDERS_PER_CHANGE = { low: 1, high: 3 };
export const MAX_TOP_PRODUCTS = 8;

// "shop.com/collections/x" → "https://shop.com"; null if it isn't a URL.
export function storeOrigin(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    if (!u.hostname.includes(".")) return null;
    return `https://${u.hostname}`;
  } catch {
    return null;
  }
}

const time = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

const lowestPrice = (p: ShopifyProduct) => {
  const prices = (p.variants ?? []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : 0;
};

// Latest change to the product or any of its variants.
const lastChange = (p: ShopifyProduct) => Math.max(time(p.updated_at), ...(p.variants ?? []).map((v) => time(v.updated_at)));

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeCatalog(products: ShopifyProduct[], origin: string, sinceMs: number): CatalogSummary {
  const changed = products
    .filter((p) => p.title && lastChange(p) > sinceMs && time(p.created_at) <= sinceMs)
    .sort((a, b) => lastChange(b) - lastChange(a));
  const newCount = products.filter((p) => time(p.created_at) > sinceMs).length;
  const priced = (list: ShopifyProduct[]) => list.map(lowestPrice).filter((n) => n > 0);
  const prices = priced(changed).length ? priced(changed) : priced(products);
  const avgPrice = prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const changedRevenue = priced(changed).reduce((a, b) => a + b, 0);
  return {
    productCount: products.length,
    updatedCount: changed.length,
    newCount,
    avgPrice,
    estOrdersLow: changed.length * ORDERS_PER_CHANGE.low,
    estOrdersHigh: changed.length * ORDERS_PER_CHANGE.high,
    estRevenueLow: round2(changedRevenue * ORDERS_PER_CHANGE.low),
    estRevenueHigh: round2(changedRevenue * ORDERS_PER_CHANGE.high),
    topProducts: changed.slice(0, MAX_TOP_PRODUCTS).map((p) => ({
      title: p.title!.slice(0, 200),
      url: p.handle ? `${origin}/products/${p.handle}` : origin,
      imageUrl: p.images?.[0]?.src ?? "",
      price: lowestPrice(p),
      updatedAt: new Date(lastChange(p)).toISOString(),
    })),
  };
}

const oneDecimal = (n: number) => n.toFixed(1).replace(/\.0$/, "");
const money = (n: number) =>
  n >= 1_000_000 ? `$${oneDecimal(n / 1_000_000)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : n >= 1000 ? `$${oneDecimal(n / 1000)}K` : `$${Math.round(n)}`;

// Monthly revenue range from daily snapshots, e.g. "$12K–$36K/mo".
export function monthlyRevenueRange(days: { estRevenueLow: number; estRevenueHigh: number }[]): string | null {
  if (!days.length) return null;
  const avg = (k: "estRevenueLow" | "estRevenueHigh") => days.reduce((a, d) => a + d[k], 0) / days.length;
  return `${money(avg("estRevenueLow") * 30)}–${money(avg("estRevenueHigh") * 30)}/mo`;
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
