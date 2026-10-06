import { markStatsDirty } from "../stats";
import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { richAdFields, defined } from "../lib/adFields";
import { toAlpha2 } from "../lib/countryCodes";
import { classifyNiche } from "../lib/category";
import {
  ALPHA2_TO_ALPHA3,
  NICHE_KEYWORDS,
  estimateSpendRange,
  platformLabel,
  type AdLibrarySearchResponse,
} from "./client";

const ADLIBRARY_SEARCH_URL = "https://adlibrary.com/api/search";
const ADLIBRARY_DETAIL_URL = "https://adlibrary.com/api/ad-detail";

// AdLibrary charges 1 credit per REQUEST, not per ad, and returns up to 60
// ads per request. Asking for the full 60 gives 6x the ads for the same
// credits as the old pageSize of 10.
const PAGE_SIZE = 60;
// Extra pages per niche cost 1 credit each. Default 1 (= 6 credits per run).
// Override with the ADLIBRARY_PAGES_PER_NICHE secret (max 5).
const pagesPerNiche = () => Math.min(5, Math.max(1, Number(process.env.ADLIBRARY_PAGES_PER_NICHE ?? 1) || 1));
// Ad-detail calls are free (no credits) but share the 10 requests/minute
// limit, so enrichment is capped per run. Override with ADLIBRARY_ENRICH_PER_RUN.
const enrichPerRun = () => Math.min(40, Math.max(0, Number(process.env.ADLIBRARY_ENRICH_PER_RUN ?? 12) || 0));
// 10 requests/minute → keep at least 6.5s between any two AdLibrary calls.
const REQUEST_GAP_MS = 6500;

// Countries AdSpy Pro actually covers. Mirrors src/lib/countries.ts, kept
// server-side since the frontend list isn't importable from Convex.
const TARGET_COUNTRIES_ALPHA2 = Object.keys(ALPHA2_TO_ALPHA3);

type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  enriched: number;
  skippedNoText: number;
  skippedNoCountry: number;
  sampleGeo: string[];
  sampleKeys: string[];
  creditsUsed: number;
  creditsRemaining: number | null;
  errors: string[];
  productsCreated: number;
  productsUpdated: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Pulls e-commerce ads for each curated niche keyword from AdLibrary.com and
// upserts them into the `ads` table, then enriches newly found ads with the
// free ad-detail endpoint (audience age/gender, AdLibrary's cost estimate).
// Runs as a single internal action so it can be triggered both by an admin
// button and by the recurring cron. All calls are spaced to respect
// AdLibrary's rate limit (10 req/min, 10,000/day).
export const runSync = internalAction({
  // nicheLimit: only sync the first N niches (1 = a 1-credit test run).
  args: { nicheLimit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SyncResult> => {
    const result: SyncResult = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      enriched: 0,
      skippedNoText: 0,
      skippedNoCountry: 0,
      sampleGeo: [],
      sampleKeys: [],
      creditsUsed: 0,
      creditsRemaining: null,
      errors: [],
      productsCreated: 0,
      productsUpdated: 0,
    };

    const apiKey = process.env.ADLIBRARY_API_KEY;
    if (!apiKey) {
      result.errors.push("ADLIBRARY_API_KEY secret is not set. Add it in the Secrets tab.");
      return result;
    }

    let lastRequestAt = 0;
    const throttle = async () => {
      const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
    };

    const newAdKeys: string[] = [];
    let outOfCredits = false;

    const niches = NICHE_KEYWORDS.slice(0, Math.max(1, args.nicheLimit ?? NICHE_KEYWORDS.length));
    for (const { niche, keyword } of niches) {
      if (outOfCredits) break;
      let productPicked = false;

      let retried429 = false;
      for (let page = 1; page <= pagesPerNiche(); page++) {
        try {
          await throttle();
          const response = await fetch(ADLIBRARY_SEARCH_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              keyword,
              appType: "3",
              preciseSearch: false,
              sortField: "-heat_degree",
              daysBack: 30,
              platform: ["facebook", "instagram", "tiktok"],
              geo: TARGET_COUNTRIES_ALPHA2.map((code) => ALPHA2_TO_ALPHA3[code]),
              duplicateRemoval: true,
              page,
              pageSize: PAGE_SIZE,
            }),
          });

          if (response.status === 402) {
            result.errors.push("AdLibrary: out of credits (HTTP 402). Top up credits to continue syncing.");
            outOfCredits = true;
            break;
          }
          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("retry-after")) || 60;
            await sleep(retryAfter * 1000);
            if (!retried429) {
              // Retry the same page once instead of silently losing it.
              retried429 = true;
              page -= 1;
              continue;
            }
            result.errors.push(`${niche}: rate limited twice, skipped page ${page}`);
            continue;
          }
          if (!response.ok) {
            const text = await response.text();
            result.errors.push(`${niche}: AdLibrary API error ${response.status} — ${text.slice(0, 200)}`);
            break;
          }

          const data: AdLibrarySearchResponse = await response.json();
          const results = data.results ?? [];
          result.creditsUsed += data._credits?.used ?? 0;
          result.creditsRemaining = data._credits?.remaining ?? result.creditsRemaining;
          result.fetched += results.length;

          // Winning Products: the search results are already sorted by heat
          // (-heat_degree), so the first result with the fields needed for a
          // real product card (image, headline, landing page) is this niche's
          // top-performing live ad. No extra AdLibrary credits spent.
          if (!productPicked) {
            const topProductCandidate = results.find(
              (item) => (item.title || item.message) && item.preview_img_url
            );
            if (topProductCandidate) {
              productPicked = true;
              const outcome = await ctx.runMutation(internal.adlibrary.productSync.upsertProductFromTopAd, {
                niche,
                adKey: topProductCandidate.ad_key,
                advertiserName:
                  topProductCandidate.advertiser_name || topProductCandidate.page_name || "Unknown advertiser",
                platform: topProductCandidate.platform,
                headline: topProductCandidate.title || topProductCandidate.message || "",
                bodyText: topProductCandidate.body || topProductCandidate.message || "",
                imageUrl: topProductCandidate.preview_img_url ?? "",
                landingPageUrl: topProductCandidate.landing_page_url ?? "",
                heat: topProductCandidate.heat ?? 0,
                daysCount: topProductCandidate.days_count ?? 0,
                impression: topProductCandidate.impression ?? 0,
              });
              if (outcome === "created") result.productsCreated += 1;
              else result.productsUpdated += 1;
            }
          }

          if (result.sampleKeys.length === 0 && results[0]) result.sampleKeys = Object.keys(results[0]).slice(0, 60);
          for (const item of results) {
            if (!item.title && !item.message && !item.body) {
              result.skipped += 1;
              result.skippedNoText += 1;
              continue;
            }
            // The live search API no longer returns `geo`. The search itself is
            // already limited to AdSpy Pro's countries, so keep the ad as
            // "INTL" and let the free ad-detail enrichment set the real country.
            let country = resolveCountry(item.geo);
            if (!country) {
              if (item.geo && item.geo.length) {
                // geo present but only unsupported countries → skip
                result.skipped += 1;
                result.skippedNoCountry += 1;
                if (result.sampleGeo.length < 8) result.sampleGeo.push(JSON.stringify(item.geo).slice(0, 120));
                continue;
              }
              country = "INTL";
            }

            const headline = item.title || item.message || item.caption || "Untitled ad";
            const bodyText = item.body || item.message || item.caption || "";
            const outcome: "created" | "updated" = await ctx.runMutation(internal.adlibrary.sync.upsertAd, {
              externalId: item.ad_key,
              advertiserName: item.advertiser_name || item.page_name || "Unknown advertiser",
              platform: platformLabel(item.platform),
              country,
              // What the ad actually sells; the search niche only when unclear.
              niche: classifyNiche(
                { title: headline, body: bodyText, url: item.landing_page_url, advertiser: item.advertiser_name || item.page_name },
                niche,
              ),
              headline,
              bodyText,
              creativeUrl: item.preview_img_url || item.video_url || "",
              landingPageUrl: item.landing_page_url || "",
              spendEstimate: spendFrom(item.estimated_spend) ?? estimateSpendRange(item.impression || item.all_exposure_value),
              likes: item.like_count ?? 0,
              // view_count is usually empty for Meta ads; impressions are the
              // real reach signal AdLibrary returns for them.
              views: formatViews(item.view_count || item.impression || item.all_exposure_value),
              daysRunning: computeDaysRunning(item),
              aiScore: computeHeatScore(item),
              firstSeenAt: item.first_seen
                ? new Date(item.first_seen * 1000).toISOString()
                : new Date().toISOString(),
              firstSeenKnown: !!item.first_seen,
              ...searchRich(item),
            });

            if (outcome === "created") {
              result.created += 1;
              newAdKeys.push(item.ad_key);
            } else result.updated += 1;
          }

          // Last page reached — don't spend a credit on an empty page.
          if (results.length < PAGE_SIZE || page * PAGE_SIZE >= (data.total ?? 0)) break;
        } catch (error) {
          result.errors.push(`${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
          break;
        }
      }
    }

    // Free enrichment (country, landing page, audience, AdLibrary spend) runs
    // in the background in rate-limited batches until every ad is done.
    if (result.created > 0 && enrichPerRun() > 0) {
      await ctx.scheduler.runAfter(10_000, internal.adlibrary.sync.enrichPending, {});
    }
    void newAdKeys;

    return result;
  },
});

// AdLibrary returns untyped JSON whose shape varies by endpoint; it is read
// defensively, field by field (typeof / Array.isArray / Number() checks).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiJson = any;

// Rich fields straight from a search result (all optional).
function mediaUrl(item: ApiJson): { videoUrl?: string; imageUrl?: string } {
  const res = Array.isArray(item.resource_urls) ? item.resource_urls : [];
  const withVideo = res.find((r: ApiJson) => typeof r?.video_url === "string" && r.video_url);
  return {
    videoUrl: item.video_url || withVideo?.video_url || undefined,
    imageUrl: item.preview_img_url || res.find((r: ApiJson) => r?.image_url)?.image_url,
  };
}
function searchRich(item: ApiJson) {
  const { videoUrl } = mediaUrl(item);
  const lastSeen = typeof item.last_seen === "number" && item.last_seen > 0 ? item.last_seen * 1000 : undefined;
  const type = Number(item.ads_type);
  return defined({
    externalKey: item.ad_key as string | undefined,
    mediaType: type === 2 || videoUrl ? "video" : type === 3 ? "carousel" : "image",
    videoUrl,
    advertiserAvatar: typeof item.logo_url === "string" && item.logo_url ? item.logo_url : undefined,
    ctaText: (item.button_text || item.call_to_action || undefined) as string | undefined,
    impressions: Number(item.impression || item.all_exposure_value) || undefined,
    comments: typeof item.comment_count === "number" ? item.comment_count : undefined,
    shares: typeof item.share_count === "number" ? item.share_count : undefined,
    lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : undefined,
    isActive: lastSeen ? Date.now() - lastSeen < 4 * 86_400_000 : undefined,
    relatedAdsCount: typeof item.related_ads_count === "number" ? item.related_ads_count : undefined,
  });
}

// AdLibrary's own spend estimate, when the search result has one.
function spendFrom(value: unknown): string | undefined {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const fmt = (x: number) => (x >= 1000 ? `$${Math.round(x / 1000)}K` : `$${Math.round(x)}`);
  return `~${fmt(n)} (AdLibrary est.)`;
}

function formatViews(count: number | undefined): string {
  if (!count) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

// days_count when AdLibrary provides it, else derived from first/last seen.
function computeDaysRunning(item: { days_count?: number; first_seen?: number; last_seen?: number }): number {
  if (item.days_count && item.days_count > 0) return item.days_count;
  if (item.first_seen) {
    const end = item.last_seen ?? Math.floor(Date.now() / 1000);
    return Math.max(1, Math.round((end - item.first_seen) / 86400));
  }
  return 0;
}

// Parser for GET /api/ad-detail (shape verified 2026-09-27):
// { detail: { countries: ["ITA",...], days_count, impression, store_url,
//   cta_redirect_urls, ad_cost, ... }, audience: { min_age, max_age, sex,
//   total_reach, sex_detail[{type,percent}], location_detail[{code,count}] } }
// Only maps fields that are present. Never fabricates targeting or spend.
type AdDetail = {
  targeting?: { ageRange: string; gender: string; interests: string[] };
  spendEstimate?: string;
  country?: string;
  landingPageUrl?: string;
  views?: string;
  daysRunning?: number;
  impressions?: number;
  countries?: string[];
  videoUrl?: string;
  language?: string;
  lastSeenAt?: string;
  isActive?: boolean;
  audience?: {
    totalReach?: number;
    malePct?: number;
    femalePct?: number;
    ages: { bracket: string; pct: number }[];
    countries: { code: string; pct: number }[];
  };
};
// Any alpha-2/alpha-3/English name → alpha-2, but only for countries AdSpy
// Pro covers (used to pick the ad's primary country).
const supportedAlpha2 = (code: unknown): string | undefined => {
  const c = toAlpha2(code);
  return c && ALPHA2_TO_ALPHA3[c] ? c : undefined;
};
function parseAdDetail(json: unknown): AdDetail {
  const root = (json ?? {}) as Record<string, ApiJson>;
  const data = (root.data ?? root) as Record<string, ApiJson>;
  const detail = (data.detail ?? {}) as Record<string, ApiJson>;
  const audience = (data.audience ?? detail.audience ?? null) as Record<string, ApiJson> | null;
  const out: AdDetail = {};

  if (audience) {
    const minAge = Number(audience.min_age);
    const maxAge = Number(audience.max_age);
    const ageRange =
      minAge > 0 && maxAge > 0 ? `${minAge}–${maxAge >= 65 ? "65+" : maxAge}` : minAge > 0 ? `${minAge}+` : "Unknown";
    // Gender: the real reached split beats the targeting setting.
    let gender = "All";
    const split = Array.isArray(audience.sex_detail) ? audience.sex_detail : [];
    const pct = (type: string) => Number(split.find((s: ApiJson) => s?.type === type)?.percent ?? 0);
    if (pct("female") >= 0.7) gender = "Female";
    else if (pct("male") >= 0.7) gender = "Male";
    else {
      const sexRaw = String(audience.sex ?? "").toLowerCase();
      if (sexRaw === "male" || sexRaw === "1") gender = "Male";
      else if (sexRaw === "female" || sexRaw === "2") gender = "Female";
    }
    // Top age brackets by reach, as readable "interest" chips.
    const ages = (Array.isArray(audience.age_detail) ? audience.age_detail : [])
      .filter((a: ApiJson) => Number(a?.count) > 0)
      .sort((a: ApiJson, b: ApiJson) => Number(b.count) - Number(a.count))
      .slice(0, 2)
      .map((a: ApiJson) => `Most reached: ${a.type}`);
    const reach = Number(audience.total_reach);
    const interests = [...ages, ...(reach > 0 ? [`EU reach ${formatViews(reach)}`] : [])];
    if (ageRange !== "Unknown" || gender !== "All" || interests.length) out.targeting = { ageRange, gender, interests };

    // Country with the most reach that AdSpy Pro covers.
    const locs = (Array.isArray(audience.location_detail) ? audience.location_detail : [])
      .slice()
      .sort((a: ApiJson, b: ApiJson) => Number(b?.count) - Number(a?.count));
    for (const l of locs) {
      const c = supportedAlpha2(l?.code);
      if (c) {
        out.country = c;
        break;
      }
    }
  }
  if (!out.country && Array.isArray(detail.countries)) {
    const priority = ["DK", "SE", "NO"];
    const mapped = detail.countries.map((c: string) => supportedAlpha2(c)).filter(Boolean) as string[];
    out.country = priority.find((p) => mapped.includes(p)) ?? mapped[0];
  }

  const cost = Number(String(detail.ad_cost ?? "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(cost) && cost > 0) {
    const fmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
    out.spendEstimate = `~${fmt(cost)} (AdLibrary est.)`;
  }
  const cta = Array.isArray(detail.cta_redirect_urls) ? detail.cta_redirect_urls.find((u: ApiJson) => typeof u === "string" && /^https?:/.test(u)) : undefined;
  const landing = cta ?? detail.store_url ?? detail.landing_page_url;
  if (typeof landing === "string" && /^https?:\/\//.test(landing)) out.landingPageUrl = landing;
  const impressions = Number(detail.impression);
  if (impressions > 0) {
    out.views = formatViews(impressions);
    out.impressions = impressions;
  }
  const days = Number(detail.days_count);
  if (days > 0) out.daysRunning = days;

  // All countries the ad runs in (alpha-2 where we know it, else as given).
  if (Array.isArray(detail.countries) && detail.countries.length) {
    out.countries = [...new Set(detail.countries.map((c: string) => toAlpha2(c) ?? String(c).toUpperCase()))].slice(0, 40) as string[];
  }
  const cdn = Array.isArray(detail.cdn_url) ? detail.cdn_url.find((u: ApiJson) => typeof u === "string" && /^https?:/.test(u)) : undefined;
  const resVideo = Array.isArray(detail.resource_urls) ? detail.resource_urls.find((r: ApiJson) => r?.video_url)?.video_url : undefined;
  if (cdn || resVideo) out.videoUrl = cdn || resVideo;
  if (typeof detail.language === "string" && detail.language) out.language = detail.language;
  if (typeof detail.last_seen === "number" && detail.last_seen > 0) {
    out.lastSeenAt = new Date(detail.last_seen * 1000).toISOString();
    out.isActive = Date.now() - detail.last_seen * 1000 < 4 * 86_400_000;
  }

  if (audience) {
    const split = Array.isArray(audience.sex_detail) ? audience.sex_detail : [];
    const pctOf = (type: string) => {
      const p = Number(split.find((s: ApiJson) => s?.type === type)?.percent);
      return Number.isFinite(p) ? Math.round(p * 1000) / 10 : undefined;
    };
    const ages = (Array.isArray(audience.age_detail) ? audience.age_detail : [])
      .filter((a: ApiJson) => typeof a?.type === "string")
      .map((a: ApiJson) => ({ bracket: String(a.type), pct: Math.round(Number(a.percent || 0) * 1000) / 10 }));
    const countries = (Array.isArray(audience.location_detail) ? audience.location_detail : [])
      .map((l: ApiJson) => ({ code: toAlpha2(l?.code) ?? String(l?.code ?? "").toUpperCase(), pct: Math.round(Number(l?.percent || 0) * 1000) / 10 }))
      .filter((c: { code: string }) => c.code)
      .slice(0, 12);
    const totalReach = Number(audience.total_reach);
    out.audience = {
      ...(totalReach > 0 ? { totalReach } : {}),
      ...(pctOf("male") !== undefined ? { malePct: pctOf("male") } : {}),
      ...(pctOf("female") !== undefined ? { femalePct: pctOf("female") } : {}),
      ages,
      countries,
    };
  }
  return out;
}

// AdLibrary's live API returns full English country names, its docs describe
// ISO alpha-3, and some responses carry alpha-2 — accept all three. Picks the
// first listed country AdSpy Pro supports. Returns undefined if the ad
// targets no supported country or has no geo data at all.
export function resolveCountry(geo: string[] | undefined): string | undefined {
  if (!geo || geo.length === 0) return undefined;
  for (const value of geo) {
    const code = supportedAlpha2(value);
    if (code) return code;
  }
  return undefined;
}

// Honest 0-100 score derived only from AdLibrary's own engagement signals
// (heat, days running, impressions) — never fabricated, never AI-inflated.
function computeHeatScore(item: { heat?: number; days_count?: number; impression?: number }): number {
  const heatComponent = Math.min(item.heat ?? 0, 1000) / 10; // 0-100
  const longevityComponent = (Math.min(item.days_count ?? 0, 60) / 60) * 100 * 0.3;
  const impressionComponent = (Math.min(item.impression ?? 0, 500000) / 500000) * 100 * 0.2;
  const score = heatComponent * 0.5 + longevityComponent + impressionComponent;
  return Math.max(1, Math.min(100, Math.round(score)));
}

const upsertAdFields = {
  externalId: v.string(),
  advertiserName: v.string(),
  platform: v.string(),
  country: v.string(),
  niche: v.string(),
  headline: v.string(),
  bodyText: v.string(),
  creativeUrl: v.string(),
  landingPageUrl: v.string(),
  spendEstimate: v.string(),
  likes: v.number(),
  views: v.string(),
  daysRunning: v.number(),
  aiScore: v.number(),
  firstSeenAt: v.string(),
  // false when AdLibrary sent no first_seen and firstSeenAt is just "now".
  firstSeenKnown: v.optional(v.boolean()),
  ...richAdFields,
};

export const upsertAd = internalMutation({
  args: upsertAdFields,
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const { externalId, firstSeenKnown, ...fields } = args;
    const existingLink = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();

    if (existingLink) {
      const existing = await ctx.db.get("ads", existingLink.adId);
      if (existing) {
        // Keep enrichment from earlier runs: don't reset targeting, and don't
        // replace an ad-detail spend estimate with the rougher impression one.
        const keepSpend = existing.spendEstimate?.includes("AdLibrary est.") && !fields.spendEstimate.includes("AdLibrary est.");
        await ctx.db.patch("ads", existingLink.adId, {
          ...defined(fields),
          spendEstimate: fields.spendEstimate,
          ...(keepSpend ? { spendEstimate: existing.spendEstimate } : {}),
          ...(fields.country === "INTL" && existing.country !== "INTL" ? { country: existing.country } : {}),
          ...(!fields.landingPageUrl && existing.landingPageUrl ? { landingPageUrl: existing.landingPageUrl } : {}),
          ...keepEarlierData(existing, fields, firstSeenKnown !== false),
          source: "adlibrary_api",
        });
        await ctx.db.patch("adlibrarySyncedAds", existingLink._id, { lastSyncedAt: new Date().toISOString() });
        return "updated";
      }
      // The ad was deleted by an admin: recreate it, as the other sources do
      // (sources/links.ts). Patching the missing ad threw and stopped the sync
      // for the rest of the niche on every run.
      await ctx.db.delete("adlibrarySyncedAds", existingLink._id);
    }

    await markStatsDirty(ctx);
    const adId = await ctx.db.insert("ads", {
      ...fields,
      targeting: { ageRange: "Unknown", gender: "All", interests: [] as string[] },
      source: "adlibrary_api",
    });
    await ctx.db.insert("adlibrarySyncedAds", {
      externalId,
      adId,
      lastSyncedAt: new Date().toISOString(),
    });
    return "created";
  },
});

// A re-sync must never make an ad look newer or smaller than we already know
// it is: keep the real first-seen date (a missing first_seen used to reset it
// to "now"), the longest run length, the largest reach, and video media found
// by enrichment.
function keepEarlierData(
  existing: Doc<"ads">,
  incoming: { firstSeenAt: string; daysRunning: number; views: string; impressions?: number; mediaType?: string },
  firstSeenKnown: boolean,
) {
  const out: Partial<Doc<"ads">> = {};
  if (!firstSeenKnown || existing.firstSeenAt < incoming.firstSeenAt) out.firstSeenAt = existing.firstSeenAt;
  if (existing.daysRunning > incoming.daysRunning) out.daysRunning = existing.daysRunning;
  if ((existing.impressions ?? 0) > (incoming.impressions ?? 0)) {
    out.impressions = existing.impressions;
    out.views = existing.views;
  }
  if (existing.videoUrl && incoming.mediaType !== "video" && incoming.mediaType !== "carousel") out.mediaType = "video";
  return out;
}

export const enrichAd = internalMutation({
  args: {
    externalId: v.string(),
    targeting: v.optional(v.object({ ageRange: v.string(), gender: v.string(), interests: v.array(v.string()) })),
    spendEstimate: v.optional(v.string()),
    country: v.optional(v.string()),
    landingPageUrl: v.optional(v.string()),
    views: v.optional(v.string()),
    daysRunning: v.optional(v.number()),
    impressions: v.optional(v.number()),
    countries: v.optional(v.array(v.string())),
    videoUrl: v.optional(v.string()),
    language: v.optional(v.string()),
    lastSeenAt: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    audience: richAdFields.audience,
  },
  handler: async (ctx, { externalId, targeting, spendEstimate, country, landingPageUrl, views, daysRunning, ...rich }) => {
    const link = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (!link) return null;
    const ad = await ctx.db.get("ads", link.adId);
    if (ad) {
      await ctx.db.patch("ads", link.adId, {
        ...(targeting ? { targeting } : {}),
        ...(spendEstimate ? { spendEstimate } : {}),
        ...(country && ad.country === "INTL" ? { country } : {}),
        ...(landingPageUrl && !ad.landingPageUrl ? { landingPageUrl } : {}),
        ...(views ? { views } : {}),
        ...(daysRunning && daysRunning > ad.daysRunning ? { daysRunning } : {}),
        ...defined(rich),
        ...(rich.videoUrl ? { mediaType: "video" } : {}),
      });
    }
    await ctx.db.patch("adlibrarySyncedAds", link._id, { enrichedAt: new Date().toISOString() });
    return null;
  },
});

export const listUnenriched = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_enriched", (q) => q.eq("enrichedAt", undefined))
      .order("desc")
      .take(limit);
    return rows.map((r) => r.externalId);
  },
});

// Background: enrich up to ~50 ads per run (6.5s apart = AdLibrary's
// 10 req/min limit), then reschedule itself until nothing is left.
// Leaves ~3 minutes of the 10-minute action limit for one slow request plus a
// 60-second rate-limit wait.
const ENRICH_TIME_BUDGET_MS = 7 * 60_000;

export const enrichPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enriched: number; remaining: boolean }> => {
    const apiKey = process.env.ADLIBRARY_API_KEY;
    if (!apiKey) return { enriched: 0, remaining: false };
    const keys: string[] = await ctx.runQuery(internal.adlibrary.sync.listUnenriched, { limit: 50 });
    // An action is stopped after 10 minutes, and then nothing reschedules the
    // chain. Stop well before that and let the next run pick up the rest.
    const started = Date.now();
    let enriched = 0;
    let failures = 0;
    let rateLimited = 0;
    let stoppedEarly = false;
    for (const adKey of keys) {
      if (Date.now() - started > ENRICH_TIME_BUDGET_MS || rateLimited >= 3) {
        stoppedEarly = true;
        break;
      }
      await sleep(REQUEST_GAP_MS);
      try {
        // Verified 2026-09-27: GET with query params + Bearer key (POST → 405).
        const response = await fetch(`${ADLIBRARY_DETAIL_URL}?${new URLSearchParams({ creative_key: adKey, app_type: "3" })}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429) {
          rateLimited += 1;
          await sleep(60_000);
          continue;
        }
        if (response.status === 404 || response.status === 405) {
          // Endpoint shape changed — stop instead of marking ads as done.
          return { enriched, remaining: false };
        }
        const enrichment = response.ok ? parseAdDetail(await response.json()) : {};
        // Mark as done even when nothing came back, so we never loop on it.
        await ctx.runMutation(internal.adlibrary.sync.enrichAd, { externalId: adKey, ...enrichment });
        if (Object.keys(enrichment).length) enriched += 1;
        if (!response.ok) failures += 1;
      } catch {
        failures += 1;
      }
    }
    if (rateLimited >= 3) {
      // AdLibrary keeps saying "too many requests": back off for a while.
      await ctx.scheduler.runAfter(15 * 60_000, internal.adlibrary.sync.enrichPending, {});
      return { enriched, remaining: true };
    }
    const remaining = (keys.length === 50 || stoppedEarly) && failures < 25;
    if (remaining) await ctx.scheduler.runAfter(5_000, internal.adlibrary.sync.enrichPending, {});
    return { enriched, remaining };
  },
});

export const enrichmentStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_enriched", (q) => q.eq("enrichedAt", undefined))
      .take(1000);
    const sampleKey = pending[0]?.externalId ?? null;
    return { pending: pending.length, sampleKey };
  },
});

// Admin diagnostic: raw ad-detail response for one ad (free endpoint) plus
// enrichment backlog. Never returns the API key.
export const debugAdDetail = action({
  args: { adKey: v.optional(v.string()), startEnrichment: v.optional(v.boolean()), resetEnrichment: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    if (args.resetEnrichment) await ctx.runMutation(internal.adlibrary.sync.resetEnrichment, {});
    const status: { pending: number; sampleKey: string | null } = await ctx.runQuery(internal.adlibrary.sync.enrichmentStatus, {});
    const adKey = args.adKey ?? status.sampleKey;
    let detail: Record<string, unknown> = {};
    if (adKey) {
      const res = await fetch(`${ADLIBRARY_DETAIL_URL}?${new URLSearchParams({ creative_key: adKey, app_type: "3" })}`, {
        headers: { Authorization: `Bearer ${process.env.ADLIBRARY_API_KEY ?? ""}` },
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: keep parsed = null and report the raw status below.
      }
      detail = {
        httpStatus: res.status,
        topKeys: parsed && typeof parsed === "object" ? Object.keys(parsed as object) : [],
        body: text.slice(0, 2500),
        parsed: parseAdDetail(parsed),
      };
    }
    if (args.startEnrichment) await ctx.scheduler.runAfter(0, internal.adlibrary.sync.enrichPending, {});
    return { ...status, adKey, ...detail };
  },
});

// Pause/resume switch for background enrichment while the endpoint is fixed.
export const resetEnrichment = internalMutation({
  args: {},
  handler: async (ctx) => {
    const done = await ctx.db.query("adlibrarySyncedAds").take(2000);
    let n = 0;
    for (const row of done) {
      if (row.enrichedAt) {
        await ctx.db.patch("adlibrarySyncedAds", row._id, { enrichedAt: undefined });
        n++;
      }
    }
    return n;
  },
});

// Admin-triggered manual sync — lets an admin pull fresh ads on demand
// without waiting for the recurring cron.
export const syncNow = action({
  args: { nicheLimit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SyncResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return await ctx.runAction(internal.adlibrary.sync.runSync, { nicheLimit: args.nicheLimit });
  },
});
