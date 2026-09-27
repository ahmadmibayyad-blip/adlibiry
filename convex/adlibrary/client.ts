// AdLibrary.com API types and country/niche mapping helpers.
// Docs: https://adlibrary.com/posts/api-documentation-and-implementation-guide
// Real ads are pulled from a paid, rate-limited third-party API (1 credit per
// request, 10 req/min, 10,000/day). We never fabricate data — every field
// mapped below comes directly from AdLibrary's response.

export type AdLibraryResult = {
  ad_key: string;
  ads_type: number;
  advertiser_name: string;
  app_type: number;
  title?: string;
  body?: string;
  message?: string;
  caption?: string;
  button_text?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  impression?: number;
  first_seen?: number; // unix seconds
  last_seen?: number; // unix seconds
  days_count?: number;
  heat?: number;
  preview_img_url?: string;
  video_url?: string;
  video_duration?: number;
  page_name?: string;
  page_id?: string;
  platform: string;
  geo?: string[];
  fb_merge_channel?: string[];
  landing_page_url?: string;
  ecommerce_platform?: string;
  independent_website?: string;
  related_ads_count?: number;
};

export type AdLibrarySearchResponse = {
  results: AdLibraryResult[];
  total: number;
  page: number;
  pageSize: number;
  _credits: {
    used: number;
    remaining: number;
    autoCharged: boolean;
    creditsAdded: number;
  };
};

// AdLibrary's `geo` uses ISO 3166 alpha-3 in its docs, but the live API
// actually returns full English country names (e.g. "United Kingdom",
// "Germany"). Map full names to the alpha-2 codes AdSpy Pro uses
// (src/lib/countries.ts) — extend both together. Only countries AdSpy Pro
// surfaces are included; ads for other countries are skipped, not dropped.
export const COUNTRY_NAME_TO_ALPHA2: Record<string, string> = {
  "United States": "US",
  "United Kingdom": "GB",
  Germany: "DE",
  France: "FR",
  Denmark: "DK",
  Sweden: "SE",
  Norway: "NO",
  Netherlands: "NL",
  Spain: "ES",
  Italy: "IT",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  Australia: "AU",
  Canada: "CA",
};

// Alpha-2 -> alpha-3, used only for the outbound `geo` search filter, which
// AdLibrary's docs specify as ISO alpha-3.
export const ALPHA2_TO_ALPHA3: Record<string, string> = {
  US: "USA",
  GB: "GBR",
  DE: "DEU",
  FR: "FRA",
  DK: "DNK",
  SE: "SWE",
  NO: "NOR",
  NL: "NLD",
  ES: "ESP",
  IT: "ITA",
  AE: "ARE",
  SA: "SAU",
  AU: "AUS",
  CA: "CAN",
};

export function platformLabel(platform: string): string {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "tiktok":
      return "TikTok";
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

// AdLibrary gives engagement signals (impressions, heat, likes) but never a
// verified dollar spend figure. Derive an honest, clearly-labeled range from
// impressions instead of fabricating a precise number.
export function estimateSpendRange(impression: number | undefined): string {
  if (!impression || impression <= 0) return "Unknown";
  // Rough, conservative CPM-based banding ($3-$12 CPM range for social ads).
  const low = Math.round((impression / 1000) * 3);
  const high = Math.round((impression / 1000) * 12);
  const fmt = (n: number) => {
    if (n >= 1000) return `$${Math.round(n / 1000)}K`;
    return `$${n}`;
  };
  return `${fmt(low)}–${fmt(high)} (impression-based est.)`;
}

// Every AdSpy Pro niche is a hand-picked English label (e.g. "Health &
// Wellness"). AdLibrary has no such taxonomy, so a niche must be supplied by
// the caller (the search keyword itself doubles as the niche label).
export const NICHE_KEYWORDS: { niche: string; keyword: string }[] = [
  { niche: "Health & Wellness", keyword: "fitness wellness" },
  { niche: "Electronics", keyword: "gadget electronics" },
  { niche: "Home & Living", keyword: "home decor" },
  { niche: "Beauty", keyword: "skincare beauty" },
  { niche: "Fashion", keyword: "fashion apparel" },
  { niche: "Pet Supplies", keyword: "pet supplies" },
];
