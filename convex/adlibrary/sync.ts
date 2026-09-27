import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, action } from "../_generated/server";
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

            const outcome: "created" | "updated" = await ctx.runMutation(internal.adlibrary.sync.upsertAd, {
              externalId: item.ad_key,
              advertiserName: item.advertiser_name || item.page_name || "Unknown advertiser",
              platform: platformLabel(item.platform),
              country,
              niche,
              headline: item.title || item.message || item.caption || "Untitled ad",
              bodyText: [item.body || item.message || item.caption || "", item.button_text || item.call_to_action ? `CTA: ${item.button_text || item.call_to_action}` : ""]
                .filter(Boolean)
                .join("\n"),
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

// Defensive parser for /api/ad-detail — only maps fields that are actually
// present. Never fabricates targeting or spend.
function parseAdDetail(json: unknown): {
  targeting?: { ageRange: string; gender: string; interests: string[] };
  spendEstimate?: string;
  country?: string;
  landingPageUrl?: string;
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
  // Countries: names or ISO codes, as an array or comma string.
  let country: string | undefined;
  const rawCountries = detail.countries ?? data.countries ?? detail.geo ?? data.geo ?? audience?.location_detail;
  const list: string[] = Array.isArray(rawCountries)
    ? rawCountries.map((c: any) => (typeof c === "string" ? c : c?.name ?? c?.country ?? c?.code ?? "")).filter(Boolean)
    : typeof rawCountries === "string"
      ? rawCountries.split(",").map((s: string) => s.trim())
      : rawCountries && typeof rawCountries === "object"
        ? Object.keys(rawCountries)
        : [];
  for (const c of list) {
    const upper = c.toUpperCase();
    if (COUNTRY_NAME_TO_ALPHA2[c]) {
      country = COUNTRY_NAME_TO_ALPHA2[c];
      break;
    }
    if (ALPHA2_TO_ALPHA3[upper]) {
      country = upper;
      break;
    }
    const fromA3 = Object.entries(ALPHA2_TO_ALPHA3).find(([, a3]) => a3 === upper)?.[0];
    if (fromA3) {
      country = fromA3;
      break;
    }
  }
  const landing = detail.store_url ?? data.store_url ?? detail.landing_page_url ?? data.landing_page_url;
  const landingPageUrl = typeof landing === "string" && /^https?:\/\//.test(landing) ? landing : undefined;
  return { targeting, spendEstimate, country, landingPageUrl };
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
      const keepSpend = existing?.spendEstimate?.includes("AdLibrary est.") && !fields.spendEstimate.includes("AdLibrary est.");
      await ctx.db.patch("ads", existingLink.adId, {
        ...fields,
        ...(keepSpend ? { spendEstimate: existing!.spendEstimate } : {}),
        ...(fields.country === "INTL" && existing && existing.country !== "INTL" ? { country: existing.country } : {}),
        ...(!fields.landingPageUrl && existing?.landingPageUrl ? { landingPageUrl: existing.landingPageUrl } : {}),
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
    country: v.optional(v.string()),
    landingPageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { externalId, targeting, spendEstimate, country, landingPageUrl }) => {
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
export const enrichPending = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enriched: number; remaining: boolean }> => {
    const apiKey = process.env.ADLIBRARY_API_KEY;
    if (!apiKey) return { enriched: 0, remaining: false };
    const keys: string[] = await ctx.runQuery(internal.adlibrary.sync.listUnenriched, { limit: 50 });
    let enriched = 0;
    let failures = 0;
    for (const adKey of keys) {
      await sleep(REQUEST_GAP_MS);
      try {
        const response = await fetch(ADLIBRARY_DETAIL_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ creative_key: adKey, app_type: "3" }),
        });
        if (response.status === 429) {
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
        if (enrichment.targeting || enrichment.spendEstimate || enrichment.country || enrichment.landingPageUrl) enriched += 1;
        if (!response.ok) failures += 1;
      } catch {
        failures += 1;
      }
    }
    const remaining = keys.length === 50 && failures < 25;
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
  args: { adKey: v.optional(v.string()), startEnrichment: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    const status: { pending: number; sampleKey: string | null } = await ctx.runQuery(internal.adlibrary.sync.enrichmentStatus, {});
    const adKey = args.adKey ?? status.sampleKey;
    let detail: Record<string, unknown> = {};
    if (adKey) {
      const res = await fetch(ADLIBRARY_DETAIL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.ADLIBRARY_API_KEY ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ creative_key: adKey, app_type: "3" }),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
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

// Admin diagnostic: try several request shapes for the ad-detail endpoint.
export const probeAdDetail = action({
  args: { adKey: v.string() },
  handler: async (ctx, { adKey }): Promise<Array<Record<string, unknown>>> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    const key = process.env.ADLIBRARY_API_KEY ?? "";
    const qs = new URLSearchParams({ creative_key: adKey, app_type: "3" }).toString();
    const variants: Array<[string, string, RequestInit]> = [
      ["GET /api/ad-detail?", `https://adlibrary.com/api/ad-detail?${qs}`, { method: "GET" }],
      ["GET /api/ad-detail (auth)", `https://adlibrary.com/api/ad-detail?${qs}`, { method: "GET", headers: { Authorization: `Bearer ${key}` } }],
      ["POST /api/v1/ad-detail", "https://adlibrary.com/api/v1/ad-detail", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ creative_key: adKey, app_type: "3" }) }],
      ["POST /api/ad-detail/", "https://adlibrary.com/api/ad-detail/", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ creative_key: adKey, app_type: "3" }) }],
      ["POST /api/search/detail", "https://adlibrary.com/api/search/detail", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ creative_key: adKey, app_type: "3" }) }],
    ];
    const out: Array<Record<string, unknown>> = [];
    for (const [name, url, init] of variants) {
      try {
        const res = await fetch(url, { ...init, redirect: "manual" });
        const text = await res.text();
        out.push({ name, status: res.status, allow: res.headers.get("allow"), location: res.headers.get("location"), body: text.slice(0, 700) });
      } catch (e) {
        out.push({ name, error: String(e) });
      }
    }
    return out;
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
