import { v, ConvexError } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { NICHE_KEYWORDS } from "./adlibrary/client";

// Apify → Meta Ad Library ads (works for DK / SE / NO, which AdLibrary and
// Nexscope barely cover). Flow: start an actor run with a webhook → Apify
// calls /apify/webhook when the run finishes → we import every dataset item.
// Env: APIFY_TOKEN (required), APIFY_ACTOR (optional, default
// curious_coder~facebook-ads-library-scraper),
// APIFY_COUNTRIES (optional, e.g. "DK,SE" → daily automatic runs).

const DEFAULT_ACTOR = "curious_coder~facebook-ads-library-scraper";

const pick = (o: any, ...keys: string[]): any => {
  for (const k of keys) {
    let cur = o;
    for (const part of k.split(".")) cur = cur == null ? undefined : cur[part];
    if (cur !== undefined && cur !== null && cur !== "" && !(Array.isArray(cur) && cur.length === 0)) return cur;
  }
  return undefined;
};
const compact = (n: number | undefined): string => {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
};
const toMs = (t: any): number | undefined => {
  if (t === undefined || t === null || t === "") return undefined;
  const n = typeof t === "number" ? t : /^\d+$/.test(String(t)) ? Number(t) : Date.parse(String(t));
  if (!Number.isFinite(n)) return undefined;
  return n < 1e12 ? n * 1000 : n;
};
// Strip l.facebook.com/l.php?u= wrappers and fbclid.
function cleanLink(u: any): string {
  if (typeof u !== "string" || !u) return "";
  try {
    const url = new URL(u);
    if (/(^|\.)l\.facebook\.com$|(^|\.)lm\.facebook\.com$/.test(url.hostname) && url.searchParams.get("u")) {
      return cleanLink(url.searchParams.get("u"));
    }
    url.searchParams.delete("fbclid");
    return url.toString();
  } catch {
    return u;
  }
}

function adLibraryUrl(country: string, keyword: string) {
  const p = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: country.toUpperCase(),
    q: keyword,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

type StartResult = { runId: string; status: string };

async function startRun(
  country: string,
  keyword: string,
  maxAds: number,
  webhookToken: string,
): Promise<StartResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set. Add it in the Convex dashboard → Settings → Environment Variables.");
  const site = process.env.CONVEX_SITE_URL;
  const actor = process.env.APIFY_ACTOR ?? DEFAULT_ACTOR;
  const query = new URLSearchParams({ token });
  if (site) {
    const hook = new URL(`${site}/apify/webhook`);
    hook.searchParams.set("run", webhookToken);
    const webhooks = [{ eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED"], requestUrl: hook.toString() }];
    query.set("webhooks", btoa(JSON.stringify(webhooks)));
  }
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [{ url: adLibraryUrl(country, keyword) }],
      count: maxAds,
      limitPerSource: maxAds,
      "scrapePageAds.activeStatus": "active",
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text)?.data ?? {};
  return { runId: String(data.id ?? ""), status: String(data.status ?? "STARTED") };
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createRun = internalMutation({
  args: { token: v.string(), country: v.string(), niche: v.string(), keyword: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("apifyRuns", { ...args, status: "started", createdAt: new Date().toISOString() });
    return null;
  },
});

export const setRunInfo = internalMutation({
  args: { token: v.string(), runId: v.optional(v.string()), status: v.string(), result: v.optional(v.string()) },
  handler: async (ctx, { token, ...patch }) => {
    const run = await ctx.db.query("apifyRuns").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (run) await ctx.db.patch("apifyRuns", run._id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return null;
  },
});

export const getRunByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    await ctx.db.query("apifyRuns").withIndex("by_token", (q) => q.eq("token", token)).unique(),
});

// Start one Apify run and remember it, so its webhook can be verified.
export const startTrackedRun = internalAction({
  args: { country: v.string(), keyword: v.string(), niche: v.string(), maxAds: v.number() },
  handler: async (ctx, args): Promise<StartResult> => {
    const token = newToken();
    await ctx.runMutation(internal.apify.createRun, { token, country: args.country.toUpperCase(), niche: args.niche, keyword: args.keyword });
    try {
      const run = await startRun(args.country, args.keyword, args.maxAds, token);
      await ctx.runMutation(internal.apify.setRunInfo, { token, runId: run.runId, status: "started" });
      return run;
    } catch (e) {
      await ctx.runMutation(internal.apify.setRunInfo, { token, status: "failed", result: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
});

// Called from the /apify/webhook HTTP route.
export const handleWebhook = internalAction({
  args: { token: v.string(), datasetId: v.optional(v.string()), eventType: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const run = await ctx.runQuery(internal.apify.getRunByToken, { token: args.token });
    if (!run || run.status === "imported") return { ok: false };
    if (args.eventType === "ACTOR.RUN.FAILED" || !args.datasetId) {
      await ctx.runMutation(internal.apify.setRunInfo, { token: args.token, status: "failed", result: args.eventType ?? "no dataset" });
      return { ok: true };
    }
    const result = await ctx.runAction(internal.apify.importDataset, {
      datasetId: args.datasetId,
      country: run.country,
      niche: run.niche,
    });
    await ctx.runMutation(internal.apify.setRunInfo, {
      token: args.token,
      status: "imported",
      result: `${result.created} created, ${result.updated} updated, ${result.errors.length} errors`,
    });
    return { ok: true };
  },
});

export const startImportNow = action({
  args: { country: v.string(), keyword: v.string(), niche: v.string(), maxAds: v.optional(v.number()) },
  handler: async (ctx, args): Promise<StartResult & { webhook: boolean }> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    const run: StartResult = await ctx.runAction(internal.apify.startTrackedRun, {
      country: args.country,
      keyword: args.keyword,
      niche: args.niche,
      maxAds: Math.min(500, Math.max(10, args.maxAds ?? 100)),
    });
    return { ...run, webhook: !!process.env.CONVEX_SITE_URL };
  },
});

type ImportResult = { fetched: number; created: number; updated: number; skipped: number; errors: string[] };

export const importDataset = internalAction({
  args: { datasetId: v.string(), country: v.string(), niche: v.string() },
  handler: async (ctx, args): Promise<ImportResult> => {
    const token = process.env.APIFY_TOKEN;
    const result: ImportResult = { fetched: 0, created: 0, updated: 0, skipped: 0, errors: [] };
    if (!token) {
      result.errors.push("APIFY_TOKEN is not set.");
      return result;
    }
    const limit = 500;
    for (let offset = 0; offset < 20_000; offset += limit) {
      const res = await fetch(
        `https://api.apify.com/v2/datasets/${encodeURIComponent(args.datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${limit}&token=${token}`,
      );
      if (!res.ok) {
        result.errors.push(`Apify dataset ${res.status}: ${(await res.text()).slice(0, 160)}`);
        break;
      }
      const items: any[] = await res.json();
      if (!items.length) break;
      result.fetched += items.length;

      for (const it of items) {
        const archiveId = pick(it, "ad_archive_id", "adArchiveID", "adArchiveId", "adId");
        const s = pick(it, "snapshot") ?? {};
        if (!archiveId) {
          result.skipped += 1;
          continue;
        }
        const cards: any[] = pick(s, "cards") ?? [];
        let body: string = pick(s, "body.text", "body.markup.__html") ?? (typeof s.body === "string" ? s.body : "") ?? "";
        if ((!body || /\{\{[^}]+\}\}/.test(body)) && cards[0]?.body) body = cards[0].body;
        let title: string = pick(s, "title") ?? "";
        if ((!title || /\{\{[^}]+\}\}/.test(title)) && cards[0]?.title) title = cards[0].title;
        const image =
          pick(s, "images.0.original_image_url", "images.0.originalImageUrl", "images.0.resized_image_url", "images.0.resizedImageUrl") ??
          pick(s, "videos.0.video_preview_image_url", "videos.0.videoPreviewImageUrl") ??
          pick(s, "cards.0.original_image_url", "cards.0.originalImageUrl", "cards.0.video_preview_image_url", "cards.0.videoPreviewImageUrl") ??
          "";
        const platforms: string[] = (pick(it, "publisher_platform", "publisherPlatform") ?? []).map((p: string) => String(p).toLowerCase());
        const start = toMs(pick(it, "start_date", "startDate", "startDateFormatted"));
        const end = toMs(pick(it, "end_date", "endDate", "endDateFormatted"));
        const isActive = pick(it, "is_active", "isActive");
        const days = start ? Math.max(1, Math.round(((isActive === false && end ? end : Date.now()) - start) / 86_400_000)) : 0;
        const copies = Number(pick(it, "collation_count", "collationCount") ?? 1) || 1;
        const reach = Number(pick(it, "reach_estimate", "reachEstimate", "eu_total_reach", "euTotalReach") ?? 0) || 0;
        const pageName = String(pick(it, "page_name", "pageName") ?? pick(s, "page_name", "pageName") ?? "Unknown advertiser");
        const cta = pick(s, "cta_text", "ctaText") ?? cards[0]?.cta_text;
        const link = cleanLink(pick(s, "link_url", "linkUrl") ?? cards.find((c) => c.link_url || c.linkUrl)?.link_url);

        // Honest score from what Meta exposes: longevity + number of ad copies (scaling).
        const aiScore = Math.max(1, Math.min(100, Math.round((Math.min(days, 60) / 60) * 60 + (Math.min(copies, 20) / 20) * 40)));
        try {
          const outcome = await ctx.runMutation(internal.sources.links.upsertExternalAd, {
            externalId: `meta_${archiveId}`,
            source: "apify",
            advertiserName: pageName.slice(0, 200),
            platform: platforms.length === 1 && platforms[0] === "instagram" ? "Instagram" : "Facebook",
            country: args.country.toUpperCase(),
            niche: args.niche,
            headline: (title || body.split("\n")[0] || "Sponsored ad").slice(0, 500),
            bodyText: [body, cta ? `CTA: ${cta}` : "", copies > 1 ? `${copies} ad copies running` : ""].filter(Boolean).join("\n").slice(0, 2000),
            creativeUrl: String(image),
            landingPageUrl: link,
            spendEstimate: "Unknown",
            likes: 0,
            views: reach ? compact(reach) : "0",
            daysRunning: days,
            aiScore,
            firstSeenAt: new Date(start ?? Date.now()).toISOString(),
          });
          if (outcome === "created") result.created += 1;
          else result.updated += 1;
        } catch (e) {
          if (result.errors.length < 10) result.errors.push(`save ${archiveId}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (items.length < limit) break;
    }
    return result;
  },
});

// Manual import of a finished run's dataset (Apify console → Storage → Datasets → ID).
export const importDatasetNow = action({
  args: { datasetId: v.string(), country: v.string(), niche: v.string() },
  handler: async (ctx, args): Promise<ImportResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    return await ctx.runAction(internal.apify.importDataset, args);
  },
});

// Daily: only when APIFY_COUNTRIES is set (e.g. "DK,SE"). 50 ads per niche per country.
export const dailyApifyImport = internalAction({
  args: {},
  handler: async (ctx) => {
    const countries = (process.env.APIFY_COUNTRIES ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    for (const country of countries) {
      for (const { niche, keyword } of NICHE_KEYWORDS) {
        try {
          await ctx.runAction(internal.apify.startTrackedRun, { country, keyword, niche, maxAds: 50 });
        } catch (e) {
          console.error(`Apify start failed for ${country}/${niche}:`, e);
        }
      }
    }
    return null;
  },
});
