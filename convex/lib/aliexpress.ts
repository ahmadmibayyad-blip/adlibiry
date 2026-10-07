// AliExpress Affiliate API (aliexpress.affiliate.product.query) for supplier
// cost: we search by product title and take the best title match's sale price
// plus a shipping estimate as the landed cost. Pure parts here (signing,
// picking the match); convex/aliexpress.ts calls the API.

import { titleSimilarity } from "./productMatch";

export const ALIEXPRESS_ENDPOINT = "https://api-sg.aliexpress.com/sync";
export const MIN_MATCH = 0.35; // share of title words in common

/** HMAC-SHA256 signature of the sorted params (key+value concatenated), uppercase hex, as the AliExpress Open Platform expects. */
export async function signParams(params: Record<string, string>, secret: string): Promise<string> {
  const base = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export type AliProduct = {
  product_id?: number | string;
  product_title?: string;
  target_sale_price?: string;
  product_detail_url?: string;
  promotion_link?: string; // affiliate-tagged link (when a tracking id is set)
  product_main_image_url?: string;
  evaluate_rate?: string; // e.g. "96.5%" positive feedback
  lastest_volume?: number | string; // orders in the last 30 days (sic, the API's spelling)
};

export type SupplierMatch = { title: string; price: number; url: string; imageUrl?: string; rating?: number; orders?: number; similarity: number };

export const SUPPLIER_FIELDS = "product_id,product_title,target_sale_price,product_detail_url,promotion_link,product_main_image_url,evaluate_rate,lastest_volume";

/** Up to 3 close title matches with a price, best match first (more orders breaks ties); links prefer the affiliate one. */
export function topMatches(title: string, products: AliProduct[], n = 3): SupplierMatch[] {
  const out: SupplierMatch[] = [];
  for (const p of products) {
    const price = Number(p.target_sale_price);
    const url = p.promotion_link || p.product_detail_url;
    if (!p.product_title || !(price > 0) || !url) continue;
    const similarity = titleSimilarity(title, p.product_title);
    if (similarity < MIN_MATCH) continue;
    const rating = parseFloat(String(p.evaluate_rate ?? "").replace("%", ""));
    const orders = Number(p.lastest_volume);
    out.push({
      title: p.product_title.slice(0, 200),
      price,
      url,
      ...(p.product_main_image_url ? { imageUrl: p.product_main_image_url } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(Number.isFinite(orders) && orders >= 0 ? { orders } : {}),
      similarity: Math.round(similarity * 100) / 100,
    });
  }
  return out.sort((a, b) => b.similarity - a.similarity || (b.orders ?? 0) - (a.orders ?? 0)).slice(0, n);
}

/** The search query for a product title: its first 8 meaningful words. */
export function searchKeywords(title: string): string {
  return title
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join(" ");
}

/** The products array from an affiliate.product.query response, whatever its nesting. */
export function productsFromResponse(body: unknown): AliProduct[] {
  const r = (body as { aliexpress_affiliate_product_query_response?: { resp_result?: { result?: { products?: { product?: AliProduct[] } } } } })
    ?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product;
  return Array.isArray(r) ? r : [];
}
