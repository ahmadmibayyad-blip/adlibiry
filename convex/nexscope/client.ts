// Nexscope.ai API types and helpers.
// Docs: https://www.nexscope.ai/api-docs/amazon-product-discovery
// Used for two things:
// 1. Backfilling price/cost on AdLibrary-synced Winning Products, which never
//    have a price (see pricing.ts) — an averaged category benchmark.
// 2. Discovering additional real Winning Products directly from Amazon
//    listings (see productDiscovery.ts) — each one is a real, single ASIN
//    with its own real title/image/price, not a benchmark.
// We never fabricate numbers — every field mapped below comes directly from
// Nexscope's response.

export type NexscopeAmazonProduct = {
  asin?: string;
  title?: string;
  brand?: string;
  price?: number;
  imageUrl?: string;
  asinUrl?: string;
  ratings?: number; // review count
  grossProfitMargin?: number; // 0-1 fraction, e.g. 0.35 means 35%
  fbaFee?: number;
  shippingFee?: number;
  clickCountT30?: number; // 30-day click count — demand signal
  clickConversionRateComposite?: number; // 0-1 — conversion signal
  clickCountGrowthT30?: number; // 0-1 — 30-day click growth rate, can be negative in practice
};

export type NexscopeAmazonDiscoveryResponse = {
  code: number;
  msg: string | null;
  data?: {
    total?: number;
    products?: NexscopeAmazonProduct[];
  };
};

export const NEXSCOPE_AMAZON_DISCOVERY_URL =
  "https://api.nexscope.ai/api/skill-api/v1/skills/amazon-product-discovery/run";

// Maps AdSpy Pro niches to a broad Amazon search keyword. Amazon Product
// Discovery matches real listing titles, so these are concrete, common
// product nouns rather than abstract category labels (e.g. "resistance
// bands" matches real ASINs; "wellness gadget" does not).
export const NICHE_TO_AMAZON_KEYWORD: Record<string, string> = {
  "Health & Wellness": "resistance bands",
  Electronics: "wireless earbuds",
  "Home & Living": "led strip lights",
  Beauty: "led face mask",
  Fashion: "crossbody bag",
  "Pet Supplies": "dog harness",
};

// Product discovery rotates through several searches per niche (one per
// run), so each run finds products the catalog doesn't have yet instead of
// re-fetching the same top listings. Same number of API calls per run.
export const NICHE_DISCOVERY_KEYWORDS: Record<string, string[]> = {
  "Health & Wellness": ["resistance bands", "posture corrector", "neck massager", "foot massager", "knee brace", "acupressure mat", "massage gun", "back stretcher"],
  Electronics: ["wireless earbuds", "phone stand", "portable charger", "smart watch", "car phone mount", "mini projector", "bluetooth speaker", "ring light"],
  "Home & Living": ["led strip lights", "sunset lamp", "storage organizer", "electric spin scrubber", "galaxy projector", "vegetable chopper", "shower head filter", "cordless vacuum"],
  Beauty: ["led face mask", "hair straightener brush", "gua sha", "ice roller", "lash serum", "scalp massager", "nail drill", "facial steamer"],
  Fashion: ["crossbody bag", "shapewear", "compression socks", "seamless leggings", "belt bag", "sun hat", "slip on sneakers", "minimalist wallet"],
  "Pet Supplies": ["dog harness", "cat water fountain", "pet hair remover", "dog cooling mat", "cat tree", "dog chew toy", "pet grooming brush", "automatic pet feeder"],
};

// Derives an honest supplier cost estimate from Amazon's own gross profit
// margin signal when available. Never guesses a margin — if Nexscope doesn't
// report one for this listing, cost stays undefined rather than fabricated.
export function deriveCostFromMargin(price: number, grossProfitMargin: number | undefined): number | undefined {
  if (grossProfitMargin === undefined || grossProfitMargin <= 0 || grossProfitMargin >= 1) return undefined;
  return Math.round(price * (1 - grossProfitMargin) * 100) / 100;
}

// A single AdLibrary-sourced ad rarely maps to one exact Amazon listing (ad
// titles are brand/campaign copy, not product names), so rather than
// fabricate a false one-to-one price match, we average across the top
// results for the niche's generic keyword. This is presented to end users
// as an honest "estimated market price" benchmark, not this exact product's
// real price.
export function averagePriceAndCost(products: NexscopeAmazonProduct[]): { price?: number; cost?: number } {
  const priced = products.filter((p) => typeof p.price === "number" && p.price > 0).slice(0, 5);
  if (priced.length === 0) return {};

  const avgPrice = priced.reduce((sum, p) => sum + (p.price ?? 0), 0) / priced.length;
  const price = Math.round(avgPrice * 100) / 100;

  const margins = priced
    .map((p) => p.grossProfitMargin)
    .filter((m): m is number => typeof m === "number" && m > 0 && m < 1);
  if (margins.length === 0) return { price };

  const avgMargin = margins.reduce((sum, m) => sum + m, 0) / margins.length;
  const cost = deriveCostFromMargin(price, avgMargin);
  return { price, cost };
}

// Honest 0-100 score derived only from Amazon's own real demand signals
// (30-day clicks, conversion rate, review count) — never fabricated. Mirrors
// the shape of the AdLibrary heat score but built from different real inputs.
export function scoreFromAmazonSignals(product: NexscopeAmazonProduct): number {
  const clickComponent = Math.min(product.clickCountT30 ?? 0, 50_000) / 50_000 * 100 * 0.4;
  const conversionComponent = Math.min(product.clickConversionRateComposite ?? 0, 1) * 100 * 0.35;
  const reviewsComponent = Math.min(product.ratings ?? 0, 5_000) / 5_000 * 100 * 0.25;
  const score = clickComponent + conversionComponent + reviewsComponent;
  return Math.max(1, Math.min(100, Math.round(score)));
}

// Trend derived only from Amazon's own 30-day click growth rate. If Nexscope
// doesn't report growth for this listing, trend stays "Unknown" rather than
// guessing — matches the app's honest-data convention used for saturation.
export function trendFromClickGrowth(growth: number | undefined): string {
  if (growth === undefined) return "Unknown";
  if (growth >= 0.15) return "Rising";
  if (growth >= -0.05) return "Stable";
  return "Declining";
}
