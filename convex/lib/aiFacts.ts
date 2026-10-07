// What the AI tools (convex/ai.ts) are told about a product, and which rows
// count as demo data. Pure, unit tested.

/**
 * Product facts for the AI second opinion. A missing price or cost is said to
 * be unknown, never sent as $0 (a $0 cost reads as a 100% margin).
 */
export function productFacts(p: { title: string; category: string; description: string; price?: number; cost?: number }): string {
  const known = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const lines = [
    `Product: ${p.title}`,
    `Category: ${p.category}`,
    `Description: ${p.description}`,
    `Sell price: ${known(p.price) ? `$${p.price}` : "unknown"}`,
    `Supplier cost: ${known(p.cost) ? `$${p.cost}` : "unknown"}`,
    `Margin: ${known(p.price) && known(p.cost) ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : "unknown (don't guess it)"}`,
  ];
  return lines.join("\n");
}

// Demo rows from the admin seed functions (stores.ts seedStores, ads.ts
// seedAds): made-up stores and ads that must never be presented as real
// tracked competitors.
export const DEMO_STORE_HOSTS = new Set([
  "ergolife.co",
  "chargetechdirect.com",
  "glowroomco.com",
  "pawcaresupply.com",
  "glowskinbeauty.com",
  "recoverprofitness.com",
  "deskworkssupply.com",
  "streetfitapparel.com",
]);

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const isDemoStore = (s: { url: string }) => DEMO_STORE_HOSTS.has(host(s.url));
export const isDemoAd = (a: { landingPageUrl: string }) => /(^|\.)example\.com$/.test(host(a.landingPageUrl));
