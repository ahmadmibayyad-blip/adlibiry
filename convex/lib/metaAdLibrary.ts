// Meta's official Ad Library API (graph.facebook.com/<version>/ads_archive):
// the ToS-compliant way to get Meta ads. Commercial ads are only available
// for EU countries (Digital Services Act transparency); the API returns text,
// dates, platforms and EU reach, but no images or landing-page URLs.
// Pure mapping from an API row to our ad fields, so it's unit tested.

export type MetaArchiveAd = {
  id: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_captions?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
  eu_total_reach?: number;
};

export const META_FIELDS = [
  "id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "publisher_platforms",
  "languages",
  "eu_total_reach",
].join(",");

// What we search for in each niche.
export const META_SEARCH_TERMS: Record<string, string> = {
  Beauty: "skincare",
  Fashion: "dress",
  Jewelry: "necklace",
  "Health & Wellness": "posture",
  Sports: "fitness",
  "Home & Living": "kitchen gadget",
  Electronics: "wireless",
  "Pet Supplies": "dog",
  "Baby & Kids": "baby",
  Toys: "toy",
  Automotive: "car accessories",
};

const DAY = 86_400_000;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`);

export function metaAdToExternal(ad: MetaArchiveAd, country: string, niche: string, nowMs: number) {
  const start = ad.ad_delivery_start_time ? Date.parse(ad.ad_delivery_start_time) : NaN;
  const stop = ad.ad_delivery_stop_time ? Date.parse(ad.ad_delivery_stop_time) : NaN;
  const end = Number.isFinite(stop) ? stop : nowMs;
  const days = Number.isFinite(start) ? Math.max(0, Math.round((end - start) / DAY)) : 0;
  const reach = ad.eu_total_reach ?? 0;
  const platforms = (ad.publisher_platforms ?? []).map((p) => p.toLowerCase());
  const caption = ad.ad_creative_link_captions?.[0]?.trim().toLowerCase() ?? "";
  // Longevity and reach: 60 days ≈ 60 points, 1M EU reach ≈ 40 points.
  const score = Math.round(Math.min(60, days) + Math.min(40, (Math.log10(1 + reach) / 6) * 40));
  return {
    externalId: `meta_${ad.id}`,
    source: "meta_ad_library",
    advertiserName: ad.page_name?.trim() || "Unknown advertiser",
    platform: platforms.length && platforms.every((p) => p === "instagram") ? "Instagram" : "Facebook",
    country,
    niche,
    headline: ad.ad_creative_link_titles?.[0]?.trim() ?? "",
    bodyText: ad.ad_creative_bodies?.[0]?.trim() ?? "",
    creativeUrl: "",
    landingPageUrl: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(caption) ? `https://${caption}` : "",
    spendEstimate: "Unknown",
    likes: 0,
    views: reach ? compact(reach) : "0",
    impressions: reach || undefined,
    daysRunning: days,
    aiScore: Math.max(1, Math.min(100, score)),
    firstSeenAt: Number.isFinite(start) ? new Date(start).toISOString() : new Date(nowMs).toISOString(),
    lastSeenAt: new Date(nowMs).toISOString(),
    isActive: !Number.isFinite(stop) || stop > nowMs,
    countries: [country],
    language: ad.languages?.[0],
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.id)}`,
  };
}

// Commercial ads exist in the API only where the EU's Digital Services Act (or
// the UK's rules) require them; anywhere else a search comes back empty.
export const META_COMMERCIAL_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB",
]);

/** META_AD_COUNTRIES (or META_ADS_COUNTRIES) split into the ones the API can serve and the ones it can't. */
export function metaCountries(raw: string | undefined): { use: string[]; skipped: string[] } {
  const list = (raw ?? "DK,SE,DE,NL,FR").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const use = list.map((c) => (c === "UK" ? "GB" : c)).filter((c) => META_COMMERCIAL_COUNTRIES.has(c));
  return { use: [...new Set(use)], skipped: list.filter((c) => !META_COMMERCIAL_COUNTRIES.has(c === "UK" ? "GB" : c)) };
}

export type MetaApiError = { code?: number; error_subcode?: number; message?: string; type?: string };

/**
 * A Graph API error in plain words, and what to do: `stop` for token and
 * permission problems (every further call fails the same way), `retry` when
 * Meta is throttling us.
 */
export function describeMetaError(err: MetaApiError | undefined, status: number): { message: string; stop: boolean; retry: boolean } {
  const code = err?.code;
  const raw = err?.message ? ` (Meta: ${err.message.slice(0, 120)})` : "";
  if (code === 190 || status === 401) {
    return { message: `Meta token expired or invalid (code 190). Make a new long-lived token and update META_ACCESS_TOKEN.${raw}`, stop: true, retry: false };
  }
  if (code === 10 || code === 200 || code === 2332 || (code !== undefined && code >= 200 && code < 300) || status === 403) {
    return {
      message: `Meta refused access (code ${code ?? status}): finish identity confirmation at facebook.com/ID and accept the Ad Library API terms at facebook.com/ads/library/api.${raw}`,
      stop: true,
      retry: false,
    };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return { message: `Meta is rate-limiting us (code ${code ?? status}); try again later.${raw}`, stop: false, retry: true };
  }
  if (code === 100) return { message: `Meta rejected a parameter (code 100).${raw}`, stop: false, retry: false };
  return { message: `Meta API error ${code ?? `HTTP ${status}`}.${raw}`, stop: false, retry: false };
}
