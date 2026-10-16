// Store Inspector → Google & YouTube ads: a store's ads in Google's Ads Transparency Center, through ScrapeCreators
// (api.scrapecreators.com, SCRAPECREATORS_API_KEY; Google has no official API for it). Pure: googleAds.ts calls it.

export const GOOGLE_AD_PLATFORMS = ["all", "youtube", "google_search", "google_shopping"] as const;
export type GoogleAdPlatform = (typeof GOOGLE_AD_PLATFORMS)[number];

/** Lookups per day by tier (lib/billing.ts byTier): each costs 25 credits (about $0.05). */
export const GOOGLE_AD_LOOKUPS = { admin: 200, paid: 30, trial: 5, free: 2 } as const;

export type GoogleAd = {
  creativeId: string;
  advertiser: string;
  format: "text" | "image" | "video" | "other";
  imageUrl?: string;
  /** The ad in Google's Ads Transparency Center (shows the creative itself). */
  url: string;
  firstShown?: string; // ISO
  lastShown?: string;
};
export type GoogleAdsResult = { ads: GoogleAd[]; estimate?: number };

export function googleAdsUrl(domain: string, platform: GoogleAdPlatform): string {
  const q = new URLSearchParams({ domain, get_ad_details: "true" });
  if (platform !== "all") q.set("platform", platform);
  return `https://api.scrapecreators.com/v1/google/company/ads?${q}`;
}

const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** The /v1/google/company/ads answer: newest first. */
export function googleAds(body: unknown): GoogleAdsResult | null {
  const b = body as { success?: boolean; ads?: unknown[]; number_of_ads_estimate?: unknown } | null;
  if (!b || b.success === false || !Array.isArray(b.ads)) return null;
  const ads = b.ads.flatMap((x): GoogleAd[] => {
    const a = x as Record<string, unknown>;
    if (typeof a.creativeId !== "string" || typeof a.advertiserId !== "string") return [];
    const format = a.format === "text" || a.format === "image" || a.format === "video" ? a.format : "other";
    const firstShown = iso(a.firstShown);
    const lastShown = iso(a.lastShown);
    return [{
      creativeId: a.creativeId,
      advertiser: typeof a.advertiserName === "string" ? a.advertiserName.slice(0, 120) : "",
      format,
      ...(typeof a.imageUrl === "string" && a.imageUrl.startsWith("https://") ? { imageUrl: a.imageUrl } : {}),
      url: typeof a.adUrl === "string" && a.adUrl.startsWith("https://adstransparency.google.com/")
        ? a.adUrl
        : `https://adstransparency.google.com/advertiser/${a.advertiserId}/creative/${a.creativeId}`,
      ...(firstShown ? { firstShown } : {}),
      ...(lastShown ? { lastShown } : {}),
    }];
  });
  ads.sort((x, y) => (y.lastShown ?? "").localeCompare(x.lastShown ?? ""));
  const estimate = Number(b.number_of_ads_estimate);
  return { ads: ads.slice(0, 60), ...(Number.isFinite(estimate) && estimate > 0 ? { estimate } : {}) };
}

/** Days an ad has run (first to last shown), and whether it still runs (shown in the last 3 days). */
export function adRun(ad: GoogleAd, now = Date.now()): { days?: number; active: boolean } {
  const first = ad.firstShown ? Date.parse(ad.firstShown) : NaN;
  const last = ad.lastShown ? Date.parse(ad.lastShown) : NaN;
  return {
    ...(Number.isFinite(first) && Number.isFinite(last) ? { days: Math.max(1, Math.round((last - first) / 86_400_000)) } : {}),
    active: Number.isFinite(last) && now - last < 3 * 86_400_000,
  };
}
