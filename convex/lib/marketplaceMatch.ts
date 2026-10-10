// Nexscope image matches (convex/fusion.ts triggers D and E), read
// defensively: the skills' reply fields aren't fully documented, so each value
// is looked up under its likely names, and replies we can't read report the
// fields they had (for fixing the mapping) instead of failing silently.
//   reverse-product-image-search → the product's Amazon twin and its sales
//   1688-search-by-image         → wholesale suppliers (prices in CNY)

type Json = Record<string, unknown>;

const first = (o: Json, keys: string[]): unknown => {
  for (const k of keys) {
    const val = k.split(".").reduce<unknown>((cur, part) => (cur && typeof cur === "object" ? (cur as Json)[part] : undefined), o);
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return undefined;
};
const str = (o: Json, keys: string[]) => {
  const v = first(o, keys);
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : undefined;
};
const num = (o: Json, keys: string[]) => {
  const v = first(o, keys);
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export type AmazonTwin = { asin: string; title: string; url: string; price?: number; unitsPerMonth?: number; imageUrl?: string };

/** The closest Amazon listing (the skill returns the most similar first). */
export function pickAmazonTwin(products: unknown[]): AmazonTwin | null {
  for (const raw of products) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Json;
    const asin = str(p, ["asin", "ASIN", "productAsin", "product_id", "productId"]);
    const title = str(p, ["title", "productTitle", "product_title", "name"]);
    if (!asin || !/^[A-Z0-9]{10}$/i.test(asin) || !title) continue;
    const price = num(p, ["price", "currentPrice", "current_price", "salePrice", "price.value"]);
    const units = num(p, ["monthlySales", "monthly_sales", "unitsSold", "units_sold", "salesLast30Days", "boughtInPastMonth", "bought_past_month", "sales"]);
    const imageUrl = str(p, ["imageUrl", "image", "mainImage", "main_image", "image_url", "img"]);
    return {
      asin: asin.toUpperCase(),
      title: title.slice(0, 200),
      url: str(p, ["asinUrl", "url", "link", "productUrl", "product_url"]) ?? `https://www.amazon.com/dp/${asin.toUpperCase()}`,
      ...(price ? { price: Math.round(price * 100) / 100 } : {}),
      ...(units ? { unitsPerMonth: Math.round(units) } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
  }
  return null;
}

export type WholesaleMatch = { title: string; priceUsd: number; url: string; moq?: number; monthlySales?: number; imageUrl?: string };

// A 1688 offer below this share of the product's selling price is almost always
// a spare part or a listing priced at its cheapest variant (filter pads at $0.05
// for a $27 fountain), not the product itself.
export const WHOLESALE_MIN_SHARE = 0.02;

/**
 * Up to 3 1688 offers with a price, in the image search's order (closest look
 * first); prices converted from CNY. With the product's selling price, offers
 * under WHOLESALE_MIN_SHARE of it are left out.
 */
export function pickWholesale(products: unknown[], cnyPerUsd: number, sellPriceUsd?: number): WholesaleMatch[] {
  const out: WholesaleMatch[] = [];
  for (const raw of products) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Json;
    const title = str(p, ["title", "subject", "productTitle", "product_title", "name"]);
    const cny = num(p, ["price", "priceInfo.price", "price_info.price", "minPrice", "min_price", "salePrice"]);
    const url = str(p, ["url", "detailUrl", "detail_url", "productUrl", "product_url", "link"]) ??
      (str(p, ["offerId", "offer_id", "productId", "product_id"]) ? `https://detail.1688.com/offer/${str(p, ["offerId", "offer_id", "productId", "product_id"])}.html` : undefined);
    if (!title || !cny || !url) continue;
    const moq = num(p, ["moq", "minOrderQuantity", "min_order_quantity", "quantityBegin", "minOrder"]);
    const sales = num(p, ["monthlySales", "monthly_sales", "monthSold", "sold", "sales"]);
    const imageUrl = str(p, ["imageUrl", "image", "image_url", "imgUrl", "img", "mainImage"]);
    out.push({
      title: title.slice(0, 200),
      priceUsd: Math.round((cny / cnyPerUsd) * 100) / 100,
      url,
      ...(moq ? { moq: Math.round(moq) } : {}),
      ...(sales ? { monthlySales: Math.round(sales) } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  const floor = sellPriceUsd && sellPriceUsd > 0 ? sellPriceUsd * WHOLESALE_MIN_SHARE : 0;
  return out.filter((o) => o.priceUsd >= floor).slice(0, 3);
}

/** Field names of the first item, for a reply we couldn't read. */
export const fieldsOf = (products: unknown[]) =>
  products[0] && typeof products[0] === "object" ? Object.keys(products[0] as Json).slice(0, 20).join(", ") : "no items";
