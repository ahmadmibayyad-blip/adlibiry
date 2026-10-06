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
