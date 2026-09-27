import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import {
  COUNTRY_NAME_TO_ALPHA2,
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
            result.errors.push(`${niche}: rate limited, waited ${retryAfter}s and skipped page ${page}`);
            await sleep(retryAfter * 1000);
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
              (item) => (item.title || item.message) && item.preview_img_url && item.landing_page_url
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
            const country = resolveCountry(item.geo);
            if (!country) {
              // Ad targets only countries outside AdSpy Pro's supported list.
              result.skipped += 1;
              result.skippedNoCountry += 1;
              if (result.sampleGeo.length < 8) result.sampleGeo.push(JSON.stringify(item.geo ?? null).slice(0, 120));
              continue;
            }

            const outcome: "created" | "updated" = await ctx.runMutation(internal.adlibrary.sync.upsertAd, {
              externalId: item.ad_key,
              advertiserName: item.advertiser_name || item.page_name || "Unknown advertiser",
              platform: platformLabel(item.platform),
              country,
              niche,
              headline: item.title || item.message || item.caption || "Untitled ad",
              bodyText: item.body || item.message || item.caption || "",
              creativeUrl: item.preview_img_url || item.video_url || "",
              landingPageUrl: item.landing_page_url || "",
              spendEstimate: estimateSpendRange(item.impression),
              likes: item.like_count ?? 0,
              // view_count is usually empty for Meta ads; impressions are the
              // real reach signal AdLibrary returns for them.
              views: formatViews(item.view_count || item.impression),
              daysRunning: computeDaysRunning(item),
              aiScore: computeHeatScore(item),
              firstSeenAt: item.first_seen
                ? new Date(item.first_seen * 1000).toISOString()
                : new Date().toISOString(),
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

    // Free enrichment for the newest ads: audience age/gender + cost estimate.
    for (const adKey of newAdKeys.slice(0, enrichPerRun())) {
      try {
        await throttle();
        const response = await fetch(ADLIBRARY_DETAIL_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ creative_key: adKey, app_type: "3" }),
        });
        if (!response.ok) {
          if (result.errors.length < 20) result.errors.push(`ad-detail ${adKey}: HTTP ${response.status}`);
          continue;
        }
        const json = await response.json();
        const enrichment = parseAdDetail(json);
        if (!enrichment.targeting && !enrichment.spendEstimate) continue;
        await ctx.runMutation(internal.adlibrary.sync.enrichAd, { externalId: adKey, ...enrichment });
        result.enriched += 1;
      } catch (error) {
        if (result.errors.length < 20) {
          result.errors.push(`ad-detail ${adKey}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
    }

    return result;
  },
});

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

// Defensive parser for /api/ad-detail — only maps fields that are actually
// present. Never fabricates targeting or spend.
function parseAdDetail(json: unknown): {
  targeting?: { ageRange: string; gender: string; interests: string[] };
  spendEstimate?: string;
} {
  const root = (json ?? {}) as Record<string, any>;
  const data = (root.data ?? root) as Record<string, any>;
  const detail = (data.detail ?? {}) as Record<string, any>;
  const audience = (data.audience ?? detail.audience ?? null) as Record<string, any> | null;

  let targeting: { ageRange: string; gender: string; interests: string[] } | undefined;
  if (audience) {
    const minAge = Number(audience.min_age);
    const maxAge = Number(audience.max_age);
    const ageRange =
      minAge > 0 && maxAge > 0 ? `${minAge}–${maxAge >= 65 ? "65+" : maxAge}` : minAge > 0 ? `${minAge}+` : "Unknown";
    const sexRaw = String(audience.sex ?? audience.gender ?? "").toLowerCase();
    const gender =
      sexRaw === "1" || sexRaw.startsWith("m")
        ? "Male"
        : sexRaw === "2" || sexRaw.startsWith("f") || sexRaw.startsWith("w")
          ? "Female"
          : "All";
    if (ageRange !== "Unknown" || gender !== "All") targeting = { ageRange, gender, interests: [] };
  }

  let spendEstimate: string | undefined;
  const cost = detail.ad_cost ?? data.ad_cost;
  const costNumber = typeof cost === "number" ? cost : Number(String(cost ?? "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(costNumber) && costNumber > 0) {
    const fmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
    spendEstimate = `~${fmt(costNumber)} (AdLibrary est.)`;
  }
  return { targeting, spendEstimate };
}

// AdLibrary's live API returns full English country names (not the ISO
// alpha-3 codes its docs describe), and lists every targeted country, not
// just one. Match against the first name in the list that AdSpy Pro
// supports. Returns undefined if the ad targets no supported country, or
// provides no geo data at all (about half of non-Meta-sourced results) —
// those ads are skipped rather than assigned a guessed country.
function resolveCountry(geo: string[] | undefined): string | undefined {
  if (!geo || geo.length === 0) return undefined;
  for (const name of geo) {
    const code = COUNTRY_NAME_TO_ALPHA2[name];
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
};

export const upsertAd = internalMutation({
  args: upsertAdFields,
  handler: async (ctx, args): Promise<"created" | "updated"> => {
    const { externalId, ...fields } = args;
    const existingLink = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();

    if (existingLink) {
      const existing = await ctx.db.get("ads", existingLink.adId);
      // Keep enrichment from earlier runs: don't reset targeting, and don't
      // replace an ad-detail spend estimate with the rougher impression one.
      const keepSpend = existing?.spendEstimate?.includes("AdLibrary est.");
      await ctx.db.patch("ads", existingLink.adId, {
        ...fields,
        ...(keepSpend ? { spendEstimate: existing!.spendEstimate } : {}),
        source: "adlibrary_api",
      });
      await ctx.db.patch("adlibrarySyncedAds", existingLink._id, { lastSyncedAt: new Date().toISOString() });
      return "updated";
    }

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

export const enrichAd = internalMutation({
  args: {
    externalId: v.string(),
    targeting: v.optional(v.object({ ageRange: v.string(), gender: v.string(), interests: v.array(v.string()) })),
    spendEstimate: v.optional(v.string()),
  },
  handler: async (ctx, { externalId, targeting, spendEstimate }) => {
    const link = await ctx.db
      .query("adlibrarySyncedAds")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .unique();
    if (!link) return null;
    await ctx.db.patch("ads", link.adId, {
      ...(targeting ? { targeting } : {}),
      ...(spendEstimate ? { spendEstimate } : {}),
    });
    return null;
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
