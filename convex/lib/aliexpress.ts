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

export type AliProduct = { product_id?: number | string; product_title?: string; target_sale_price?: string; product_detail_url?: string };

/** The search query for a product title: its first 8 meaningful words. */
export function searchKeywords(title: string): string {
  return title
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join(" ");
}

/** Best title match with a price, or undefined when nothing is close enough. */
export function pickMatch(title: string, products: AliProduct[]): { price: number; url?: string; similarity: number } | undefined {
  let best: { price: number; url?: string; similarity: number } | undefined;
  for (const p of products) {
    const price = Number(p.target_sale_price);
    if (!p.product_title || !(price > 0)) continue;
    const similarity = titleSimilarity(title, p.product_title);
    if (similarity >= MIN_MATCH && (!best || similarity > best.similarity)) best = { price, url: p.product_detail_url, similarity };
  }
  return best;
}

/** The products array from an affiliate.product.query response, whatever its nesting. */
export function productsFromResponse(body: unknown): AliProduct[] {
  const r = (body as { aliexpress_affiliate_product_query_response?: { resp_result?: { result?: { products?: { product?: AliProduct[] } } } } })
    ?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product;
  return Array.isArray(r) ? r : [];
}
