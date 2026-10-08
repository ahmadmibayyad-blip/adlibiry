// Pure helpers for turning ads into products (see convex/productPipeline.ts):
// normalised keys for matching, product-page detection, a product title from
// the landing page, and flags for things that don't belong in Winning
// Products (big brands, personalised / print-on-demand, services & gift cards).

// Query parameters that identify the product itself; everything else
// (utm_*, fbclid, source=anchor…) is tracking and is dropped.
const ID_PARAMS = ["id", "pid", "product_id", "productid", "item_id", "sku", "variant"];

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// "https://www.shop.com/collections/x/products/lamp?utm=1" → "shop.com/products/lamp".
// Null for a home page (no product to match).
export function urlKey(url: string | undefined): string | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let path = decodeURIComponent(u.pathname).toLowerCase().replace(/\/+$/, "");
  // Shopify: the same product lives under /products/x and /collections/y/products/x.
  path = path.replace(/^\/collections\/[^/]+(\/products\/)/, "$1");
  // Amazon: /Some-Title/dp/ASIN/ref=… → /dp/ASIN
  const asin = path.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})/);
  if (asin) path = `/dp/${asin[1]}`;
  // Locale prefixes: /en-us/products/x → /products/x
  path = path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/products\/)/, "");
  const idParam = ID_PARAMS.map((p) => u.searchParams.get(p)).find(Boolean);
  if (!path && !idParam) return null;
  return `${host}${path}${idParam ? `?id=${idParam.toLowerCase()}` : ""}`.slice(0, 300);
}

const PRODUCT_PATH =
  /\/(products?|dp|gp\/product|item|items|p|pdp|goods|shop\/pdp|listing|artikel|produkt|produit|producto|prodotto)\/[^/]+|\.html?$|[?&](product_id|pid|item_id)=/i;

// Does the landing page look like one product's page (not a home page,
// blog, app store or sign-up form)?
export function isProductPage(url: string | undefined): boolean {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  if (/(^|\.)(apps\.apple\.com|play\.google\.com|facebook\.com|instagram\.com|fb\.me|wa\.me|linktr\.ee)$/.test(host)) return false;
  if (/(^|\.)tiktok\.com$/.test(host)) return /\/(shop\/pdp|view\/product)\//i.test(u.pathname);
  return PRODUCT_PATH.test(u.pathname + u.search);
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// "/products/vevor-21-inch-push-lawn-sweeper" → "Vevor 21 Inch Push Lawn Sweeper".
// Null when the slug is an id rather than words.
export function titleFromUrl(url: string | undefined): string | null {
  const u = parse(url);
  if (!u) return null;
  const m = decodeURIComponent(u.pathname).match(/\/(?:products?|item|p|listing|produkt|produit|producto|prodotto)\/([^/?#]+)/i);
  if (!m) return null;
  const words = m[1]
    .replace(/\.html?$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\b[a-z0-9]{0,3}\d{5,}\b/gi, "") // trailing ids like 1234567
    .replace(/\s+/g, " ")
    .trim();
  const letters = words.replace(/[^a-z]/gi, "");
  if (letters.length < 6 || words.split(" ").length < 2) return null;
  return titleCase(words.toLowerCase()).slice(0, 160);
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "with", "of", "in", "on", "to", "by", "your", "you", "our", "new", "best", "free",
  "shipping", "sale", "off", "buy", "get", "now", "shop", "official", "store", "hot", "deal", "pcs", "pc", "set", "pack",
]);

// Order-insensitive fingerprint of a product title; null if too generic.
export function titleKey(title: string | undefined): string | null {
  if (!title) return null;
  const tokens = [
    ...new Set(
      title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t))
        // "dogs" = "dog", "brushes" = "brush" (but keep "glass", "bus")
        .map((t) => (t.length > 3 && !t.endsWith("ss") && !t.endsWith("us") ? t.replace(/(sh|ch|x)es$/, "$1").replace(/s$/, "") : t)),
    ),
  ].sort();
  return tokens.length >= 3 ? tokens.join(" ").slice(0, 200) : null;
}

// Brands whose products (or products named after them) bring trademark claims and Meta/Shopify bans.
// Ambiguous words are only matched with the product word next to them ("ring doorbell", not "ring").
const BIG_BRANDS =
  /\b(apple (watch|pencil|tv|magsafe|vision|airpods|iphone|ipad|macbook)|iphone|ipad|airpods|airtag|macbook|apple watch|samsung|galaxy s\d+|galaxy buds|sony|playstation|ps5|xbox|nintendo|switch oled|nike|air jordan|jordan \d+|adidas|yeezy|puma|reebok|asics|hoka|new balance|converse|vans|skechers|crocs|birkenstock|ugg|dr\.? ?martens|timberland|dyson|bissell|shark ninja|ninja foodi|ninja creami|lego|disney|marvel|star wars|harry potter|pok[eé]mon|barbie|hot wheels|mattel|hasbro|squishmallows?|stitch plush|ikea|amazon basics|kindle|echo dot|fire ?tv|fire ?stick|ring (video )?doorbell|roku|chromecast|google pixel|google nest|microsoft|dell|hp laptop|lenovo|bose|beats (by dre|headphones|earbuds|studio|solo|fit|pill)|jbl|sonos|logitech|razer|steelseries|anker|gucci|louis vuitton|chanel|dior|prada|rolex|cartier|tiffany & co|versace|balenciaga|burberry|fendi|herm[eè]s|michael kors|ralph lauren|tommy hilfiger|calvin klein|levi'?s|ray-?ban|oakley|pandora (charm|bracelet|ring|necklace)|swarovski|zara|h&m|uniqlo|shein|temu|walmart|costco|starbucks|red bull|coca-?cola|nutella|l'or[eé]al|loreal|maybelline|nivea|olay|dove (soap|body ?wash|deodorant|shampoo)|colgate|oral-?b|gillette|philips|braun|kitchenaid|nespresso|keurig|de'?longhi|smeg|le creuset|tefal|instant pot|bosch|makita|dewalt|milwaukee (tool|drill|battery)|ryobi|black ?(\+|&|and) ?decker|xiaomi|huawei|garmin|fitbit|whoop (band|strap)|oura ring|gopro|dji|canon|nikon|theragun|therabody|stanley cup|stanley quencher|yeti|owala|hydro ?flask|lululemon|under armour|the north face|patagonia|carhartt|stussy)\b/i;

/** The big brand named in the text ("Roku"), or null. */
export function bigBrandIn(text: string): string | null {
  const m = text.match(BIG_BRANDS);
  return m ? m[0] : null;
}

const PERSONALISED =
  /\b(personali[sz]ed|personali[sz]able|custom(i[sz]ed|i[sz]able)?|engraved|monogram(med)?|your (name|photo|text)|name (necklace|bracelet|mug|shirt)|print[- ]on[- ]demand|made to order|photo (blanket|pillow|mug)|custom (photo|name|text|portrait)|pet portrait|family portrait)\b/i;

const SERVICE =
  /\b(gift ?cards?|e-?gift|vouchers?|subscriptions?|membership|course|masterclass|coaching|webinar|consultation|ebook|e-book|pdf guide|template|app download|insurance|loan|mortgage|credit card|casino|betting|dating|real estate|dentist|clinic|salon|repair service|cleaning service|plumber|lawyer|attorney|software|saas|free trial|sign ?up|download (the|our) app)\b/i;

export type ProductFlags = { isBigBrand: boolean; isPersonalised: boolean; isService: boolean };

export function productFlags(text: string): ProductFlags {
  return {
    isBigBrand: BIG_BRANDS.test(text),
    isPersonalised: PERSONALISED.test(text),
    isService: SERVICE.test(text),
  };
}

// Is this ad selling one physical product we can show as a product?
export function adSellsProduct(ad: { landingPageUrl: string; headline: string; bodyText: string; advertiserName: string }): boolean {
  if (!isProductPage(ad.landingPageUrl)) return false;
  return !productFlags(`${ad.headline} ${ad.bodyText.slice(0, 300)} ${ad.landingPageUrl}`).isService;
}

// Best product title for an ad: the landing page's product slug, then a
// product title the source gave (Nexscope puts it before " · GMV"), then the
// ad headline.
export function productTitleForAd(ad: { landingPageUrl: string; headline: string; bodyText: string; source: string }): string {
  const fromUrl = titleFromUrl(ad.landingPageUrl);
  if (fromUrl) return fromUrl;
  if (ad.source === "nexscope") {
    const first = ad.bodyText.split(" · ")[0]?.trim();
    if (first && !/^GMV\b/.test(first) && first.length >= 8) return first.slice(0, 160);
  }
  return ad.headline.trim().slice(0, 160) || "Untitled product";
}

// Numbers an ad carries as text: "1.2M" views, "GMV $12.3K" in the text.
export function parseCompact(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  return Math.round(n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1));
}

export function gmvFromText(text: string): number | undefined {
  const m = text.match(/GMV\s*\$?\s*([\d.,]+\s*[KMB]?)/i);
  return m ? parseCompact(m[1]) : undefined;
}

// Product-level saturation from our own ad data: how many different
// advertisers run ads for the product. One seller testing it = Low, a few =
// Medium, five or more = High.
export function saturationFromCompetition(distinctAdvertisers: number): "Low" | "Medium" | "High" {
  if (distinctAdvertisers <= 1) return "Low";
  if (distinctAdvertisers <= 4) return "Medium";
  return "High";
}

// Round-robin across niches: best product from each niche in turn, niches
// ordered by their best score. `lists` must each be sorted best first.
export function roundRobin<T>(lists: T[][]): T[] {
  const queues = lists.filter((l) => l.length > 0).map((l) => [...l]);
  const out: T[] = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}

// ── Same store, same product ────────────────────────────────────────────────
// One shop listing the same product twice (a scraped name and the store's own
// name) is a duplicate; on a marketplace the "store" says nothing.
const MARKETPLACE_HOST = /(^|\.)(amazon|ebay|etsy|walmart|aliexpress|alibaba|temu|shein|tiktok|target|wish|bestbuy)\.[a-z.]+$/;

export function storeHost(url: string | undefined): string | null {
  try {
    if (!url) return null;
    const host = new URL(url.trim()).hostname.toLowerCase().replace(/^(www|m|shop)\./, "");
    return host && !MARKETPLACE_HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** Share of title words in common (0–1), using the same normalised words as titleKey. */
export function titleSimilarity(a: string, b: string): number {
  const words = (t: string) => new Set((titleKey(t) ?? "").split(" ").filter(Boolean));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

export const SAME_TITLE_MIN = 0.7;
