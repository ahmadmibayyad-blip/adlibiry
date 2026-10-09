// Launch from any link (convex/productImport.ts): a product page on AliExpress,
// a Shopify store or any shop becomes a private product the user can launch.
// Shopify: the public /products/<handle>.js. AliExpress: the page's title and
// photo list (the price comes from the Affiliate API when it's set up). Other
// shops: og:/JSON-LD tags. Pure parsing; the fetching is in productImport.ts.

import { imagesFromHtml, imagesFromShopifyJs, shopifyJsUrl } from "./productImages";
import { priceFromHtml, toUsd, type FoundPrice } from "./priceParse";

export type ImportSource = "aliexpress" | "shopify" | "web";
export type ImportedProduct = {
  source: ImportSource;
  title: string;
  description: string;
  imageUrl: string;
  images: string[];
  /** The page's selling price in USD (a store's retail price), when known. */
  price?: number;
  /** The supplier's price in USD (AliExpress), when known. */
  cost?: number;
};

/** A clean public product link, or null (not http(s), or a local/internal host). */
export function productUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  u.hash = "";
  return u;
}

export function importSource(u: URL): ImportSource {
  if (/(^|\.)aliexpress\.[a-z.]+$/.test(u.hostname)) return "aliexpress";
  return shopifyJsUrl(u.toString()) ? "shopify" : "web";
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const plain = (html: string, max: number) => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
const meta = (html: string, name: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i"))?.[1];
const unique = (urls: string[]) => [...new Set(urls)].slice(0, 12);

/** A Shopify store's /products/<handle>.js; `currency` from its /cart.js. */
export function fromShopifyJs(body: unknown, pageUrl: string, currency?: string): ImportedProduct | null {
  const b = body as { title?: string; description?: string; price?: number; type?: string } | null;
  const title = b?.title?.trim();
  if (!title) return null;
  const images = unique(imagesFromShopifyJs(body, pageUrl));
  const amount = typeof b?.price === "number" ? b.price / 100 : undefined;
  const price = amount && currency ? toUsd({ amount, currency }) : undefined;
  return { source: "shopify", title: title.slice(0, 200), description: plain(b?.description ?? "", 1500), imageUrl: images[0] ?? "", images: images.slice(1), ...(price ? { price } : {}) };
}

/** An AliExpress item page: its title and photo list (no price: the page loads that in the browser). */
export function fromAliExpressHtml(html: string): ImportedProduct | null {
  const title = decode(meta(html, "og:title") ?? "").replace(/\s*-\s*AliExpress.*$/i, "").trim();
  if (!title) return null;
  const list = html.match(/"imagePathList":\[([^\]]*)\]/)?.[1] ?? "";
  const fromList = [...list.matchAll(/"(https:[^"]+)"/g)].map((m) => m[1]);
  const og = meta(html, "og:image");
  const images = unique([...fromList, ...(og?.startsWith("https:") ? [og] : [])]);
  return { source: "aliexpress", title: title.slice(0, 200), description: "", imageUrl: images[0] ?? "", images: images.slice(1) };
}

/** Any other shop's product page, from its og:/twitter:/JSON-LD tags. */
export function fromProductHtml(html: string, pageUrl: string): ImportedProduct | null {
  let ldName: string | undefined;
  let ldDescription: string | undefined;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== "object") return;
        const o = v as Record<string, unknown>;
        const type = String(o["@type"] ?? "");
        if (/Product/i.test(type)) {
          if (!ldName && typeof o.name === "string") ldName = o.name;
          if (!ldDescription && typeof o.description === "string") ldDescription = o.description;
        }
        if (o["@graph"]) walk(o["@graph"]);
      };
      walk(JSON.parse(m[1]));
    } catch {
      // ignore broken JSON-LD
    }
  }
  const title = decode(ldName ?? meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const found: FoundPrice | undefined = priceFromHtml(html);
  // Only product pages: product data, a product page type or a price (not a blog post or home page).
  const isProduct = !!ldName || /product/i.test(meta(html, "og:type") ?? "") || !!found;
  if (!title || !isProduct) return null;
  const images = unique(imagesFromHtml(html, pageUrl));
  const price = found ? toUsd(found) : undefined;
  return {
    source: "web",
    title: title.slice(0, 200),
    description: plain(ldDescription ?? meta(html, "og:description") ?? "", 1500),
    imageUrl: images[0] ?? "",
    images: images.slice(1),
    ...(price ? { price } : {}),
  };
}

/**
 * The product from an Apify AliExpress reader run (ALIEXPRESS_IMPORT_ACTOR, default zen-studio/aliexpress-scraper):
 * it reads AliExpress in a way AliExpress doesn't block, as it blocks servers. Price in `currency` (we ask for USD).
 */
export function fromApifyAliExpress(items: unknown): { title?: string; images: string[]; cost?: number } | null {
  if (!Array.isArray(items)) return null;
  const p = items.find((i) => i && typeof i === "object" && (i as { recordType?: string }).recordType !== "review" && typeof (i as { title?: unknown }).title === "string") as
    | Record<string, unknown>
    | undefined;
  if (!p) return null;
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).filter((u): u is string => typeof u === "string") : []);
  const images = unique([String(p.imageUrl ?? ""), ...list("images"), ...list("imageUrls"), ...list("gallery")].map((u) => (u.startsWith("//") ? `https:${u}` : u)).filter((u) => u.startsWith("https:")));
  const price = Number(p.price);
  const cost = Number.isFinite(price) && price > 0 ? (String(p.currency ?? "USD").toUpperCase() === "USD" ? price : toUsd({ amount: price, currency: String(p.currency) })) : undefined;
  return { title: String(p.title).trim().slice(0, 200), images, ...(cost ? { cost: Math.round(cost * 100) / 100 } : {}) };
}

/** The first product in an aliexpress.affiliate.productdetail.get response: price in USD and photos. */
export function fromAliExpressApi(body: unknown): { cost?: number; images: string[]; title?: string } | null {
  const p = (body as { aliexpress_affiliate_productdetail_get_response?: { resp_result?: { result?: { products?: { product?: Record<string, unknown>[] } } } } })
    ?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product?.[0];
  if (!p) return null;
  const cost = Number(p.target_sale_price ?? p.sale_price);
  const small = (p.product_small_image_urls as { string?: string[] } | undefined)?.string ?? [];
  const images = unique([String(p.product_main_image_url ?? ""), ...small].filter((u) => u.startsWith("https:")));
  return { ...(Number.isFinite(cost) && cost > 0 ? { cost } : {}), images, ...(typeof p.product_title === "string" ? { title: p.product_title } : {}) };
}
