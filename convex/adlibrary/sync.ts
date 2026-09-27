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

// Countries AdSpy Pro actually covers. Mirrors src/lib/countries.ts, kept
// server-side since the frontend list isn't importable from Convex.
const TARGET_COUNTRIES_ALPHA2 = Object.keys(ALPHA2_TO_ALPHA3);

type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  errors: string[];
  productsCreated: number;
  productsUpdated: number;
};

// Pulls e-commerce ads for each curated niche keyword from AdLibrary.com and
// upserts them into the `ads` table. Runs as a single internal action so it
// can be triggered both by an admin button and by the recurring cron —
// bounded to one page per niche per run to respect AdLibrary's rate limits
// (10 req/min, 10,000/day) and to keep each run's credit usage small and
// predictable.
export const runSync = internalAction({
  args: {},
  handler: async (ctx): Promise<SyncResult> => {
    const apiKey = process.env.ADLIBRARY_API_KEY;
    if (!apiKey) {
      return {
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        creditsUsed: 0,
        creditsRemaining: null,
        errors: ["ADLIBRARY_API_KEY secret is not set. Add it in the Secrets tab."],
        productsCreated: 0,
        productsUpdated: 0,
      };
    }

    const result: SyncResult = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      creditsUsed: 0,
      creditsRemaining: null,
      errors: [],
      productsCreated: 0,
      productsUpdated: 0,
    };

    for (const { niche, keyword } of NICHE_KEYWORDS) {
      try {
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
            pageSize: 10,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          result.errors.push(`${niche}: AdLibrary API error ${response.status} — ${text.slice(0, 200)}`);
          continue;
        }

        const data: AdLibrarySearchResponse = await response.json();
        result.creditsUsed += data._credits?.used ?? 0;
        result.creditsRemaining = data._credits?.remaining ?? result.creditsRemaining;
        result.fetched += data.results.length;

        // Winning Products: the search results are already sorted by heat
        // (-heat_degree), so the first result with the fields needed for a
        // real product card (image, headline, landing page) is this niche's
        // top-performing live ad. No extra AdLibrary credits spent.
        const topProductCandidate = data.results.find(
          (item) => (item.title || item.message) && item.preview_img_url && item.landing_page_url
        );
        if (topProductCandidate) {
          const outcome = await ctx.runMutation(internal.adlibrary.productSync.upsertProductFromTopAd, {
            niche,
            adKey: topProductCandidate.ad_key,
            advertiserName: topProductCandidate.advertiser_name || topProductCandidate.page_name || "Unknown advertiser",
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

        for (const item of data.results) {
          if (!item.title && !item.message && !item.body) {
            result.skipped += 1;
            continue;
          }
          const country = resolveCountry(item.geo);
          if (!country) {
            // Ad targets only countries outside AdSpy Pro's supported list.
            result.skipped += 1;
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
            views: formatViews(item.view_count),
            daysRunning: item.days_count ?? 0,
            aiScore: computeHeatScore(item),
            firstSeenAt: item.first_seen ? new Date(item.first_seen * 1000).toISOString() : new Date().toISOString(),
          });

          if (outcome === "created") result.created += 1;
          else result.updated += 1;
        }
      } catch (error) {
        result.errors.push(`${niche}: ${error instanceof Error ? error.message : "Unknown error"}`);
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
  const longevityComponent = Math.min(item.days_count ?? 0, 60) / 60 * 100 * 0.3;
  const impressionComponent = Math.min(item.impression ?? 0, 500000) / 500000 * 100 * 0.2;
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

    const adDoc = {
      ...fields,
      targeting: { ageRange: "Unknown", gender: "All", interests: [] as string[] },
      source: "adlibrary_api",
    };

    if (existingLink) {
      await ctx.db.patch("ads", existingLink.adId, adDoc);
      await ctx.db.patch("adlibrarySyncedAds", existingLink._id, { lastSyncedAt: new Date().toISOString() });
      return "updated";
    }

    const adId = await ctx.db.insert("ads", adDoc);
    await ctx.db.insert("adlibrarySyncedAds", {
      externalId,
      adId,
      lastSyncedAt: new Date().toISOString(),
    });
    return "created";
  },
});

// Admin-triggered manual sync — lets an admin pull fresh ads on demand
// without waiting for the recurring cron.
export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<SyncResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return await ctx.runAction(internal.adlibrary.sync.runSync, {});
  },
});
