// AliExpress Affiliate API (aliexpress.affiliate.product.query) for supplier
// cost: we search by product title and take the best title match's sale price
// plus a shipping estimate as the landed cost. Pure parts here (signing,
// picking the match); convex/aliexpress.ts calls the API.

export const ALIEXPRESS_ENDPOINT = "https://api-sg.aliexpress.com/sync";
export const MIN_MATCH = 0.5; // share of the product's own title words found in the supplier's title

// Words that say nothing about what the product is: offers, counts, sizes,
// colours and fillers. Dropped before matching so "2 x … (Buy 1 & Get 1 Free)"
// matches on what's being sold.
const FILLER = new Set(
  ("a an and the of for with to in on by at from or new hot sale best top quality premium original official buy get free " +
    "pack packs pc pcs piece pieces set sets x xs xl xxl xxxl small medium large big mini size one two three plus " +
    "black white red blue green pink grey gray brown beige yellow purple orange gold silver color colour").split(" "),
);

/** A title's meaningful words: lowercase, no numbers or units, simple plurals folded ("leggings" → "legging"). */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/\d/.test(w) && !FILLER.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * What the product is: the last meaningful word before the title's first
 * aside ("Resistance Band Leggings (Buy 1…)" → "legging"; "Pet brush for dogs"
 * → "brush"; "… Cat Water Fountain 108oz C1" → "fountain").
 */
export function headNoun(title: string): string | undefined {
  const clause = title.split(/[([,|–—:]| - | for | with | to | in | by /i)[0];
  const words = titleWords(clause);
  return words[words.length - 1];
}

/**
 * How well a supplier's listing title matches a product: the share of the
 * product's own words it contains, and 0 when it doesn't name the same thing
 * (the head noun). Supplier titles are long and keyword-stuffed, so a symmetric
 * overlap (Jaccard) scores real matches ~0.1–0.2; this one doesn't.
 */
export function supplierMatchScore(productTitle: string, supplierTitle: string): number {
  const own = [...new Set(titleWords(productTitle))];
  if (!own.length) return 0;
  const theirs = new Set(titleWords(supplierTitle));
  const head = headNoun(productTitle);
  if (head && !theirs.has(head)) return 0;
  return own.filter((w) => theirs.has(w)).length / own.length;
}

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
    const similarity = supplierMatchScore(title, p.product_title);
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

/** The search query for a product title: its first 8 words without offers or counts, always including what the product is. */
export function searchKeywords(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(buy|get|free|pack|pcs?|x)$/i.test(w) && !/^\d+x?$/i.test(w))
    .slice(0, 8);
  const head = headNoun(title);
  if (head && !words.some((w) => titleWords(w)[0] === head)) words.push(head);
  return words.join(" ");
}

/** The products array from an affiliate.product.query response, whatever its nesting. */
export function productsFromResponse(body: unknown): AliProduct[] {
  const r = (body as { aliexpress_affiliate_product_query_response?: { resp_result?: { result?: { products?: { product?: AliProduct[] } } } } })
    ?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product;
  return Array.isArray(r) ? r : [];
}

/**
 * Search results from the Apify AliExpress reader (zen-studio/aliexpress-scraper, keyword search without
 * details) in the Affiliate API's shape, for topMatches. Its rating is stars, not % positive, so it's left out.
 */
export function fromApifySearch(items: unknown): AliProduct[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((x) => {
    const i = x as { title?: unknown; price?: unknown; url?: unknown; productId?: unknown; image?: unknown; gallery?: unknown; currency?: unknown };
    const price = Number(i.price);
    const url = typeof i.url === "string" && i.url ? i.url : i.productId ? `https://www.aliexpress.com/item/${String(i.productId)}.html` : "";
    if (typeof i.title !== "string" || !(price > 0) || !url || (i.currency && i.currency !== "USD")) return [];
    const image = typeof i.image === "string" && i.image ? i.image : Array.isArray(i.gallery) && typeof i.gallery[0] === "string" ? i.gallery[0] : undefined;
    return [{ product_title: i.title, target_sale_price: String(price), product_detail_url: url, ...(image ? { product_main_image_url: image } : {}) }];
  });
}
