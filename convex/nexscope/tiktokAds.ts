import { v, ConvexError } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { NICHE_KEYWORDS } from "../adlibrary/client";
import { classifyNiche } from "../lib/category";

// Nexscope.ai → TikTok ads (chuhaijiang-tiktok-ad-search / -ad-detail) and
// Shopify stores that advertise (shopify-store-query).
// Docs: https://github.com/nexscope-ai/nexscope-ecommerce-api
// Notes from the docs that the old integration missed:
//  • ad-search returns max 10 ads per call and never paginates by itself
//  • ad-search has NO image — cover/avatar + comments/shares come from ad-detail
//  • errors can arrive as HTTP 200 with errcode != 200 in the body

const BASE = "https://api.nexscope.ai/api/skill-api/v1/skills";
// Markets the TikTok ad endpoints accept that AdSpy Pro also lists (no DK/SE on Nexscope).
export const NEXSCOPE_TIKTOK_COUNTRIES = ["gb", "de", "fr", "es", "it", "us"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSkill(slug: string, body: Record<string, unknown>, attempt = 0): Promise<any> {
  const key = process.env.NEXSCOPE_API_KEY;
  if (!key) throw new Error("NEXSCOPE_API_KEY is not set. Add it in the Convex dashboard → Settings → Environment Variables.");
  const res = await fetch(`${BASE}/${slug}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt * 2) * 1000);
    return runSkill(slug, body, attempt + 1);
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Nexscope ${slug}: HTTP ${res.status} ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`Nexscope ${slug}: HTTP ${res.status} ${(json?.errmsg ?? json?.msg ?? text).toString().slice(0, 160)}`);
  const code = json.errcode ?? json.code;
  if (code !== undefined && code !== 200 && code !== 0) {
    throw new Error(`Nexscope ${slug}: ${json.errmsg ?? json.msg ?? json.message ?? `error ${code}`}`);
  }
  return json;
}

const num = (x: unknown): number | undefined => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (x && typeof x === "object") return num((x as any).value ?? (x as any).amount);
  if (typeof x === "string" && x.trim()) {
    const n = Number(x.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const imgUrl = (x: unknown): string => {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as any;
    return o.url ?? o.uri ?? (o.url_list ?? o.urlList ?? o.urls ?? [])[0] ?? "";
  }
  return "";
};
const compact = (n: number | undefined): string => {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
};
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
const toIso = (t: unknown): string => {
  const n = num(t);
  if (!n) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
};

// Honest 0-100 score from Nexscope's own signals only (views, days running, GMV).
function score(views: number, days: number, gmv: number): number {
  const v = (Math.min(views, 2_000_000) / 2_000_000) * 100 * 0.4;
  const d = (Math.min(days, 60) / 60) * 100 * 0.3;
  const g = (Math.min(gmv, 200_000) / 200_000) * 100 * 0.3;
  return Math.max(1, Math.min(100, Math.round(v + d + g)));
}

type ImportResult = { fetched: number; created: number; updated: number; errors: string[]; totalAvailable: number };

export const importTikTokAds = internalAction({
  args: {
    country: v.string(),
    keyword: v.string(),
    niche: v.string(),
    maxPages: v.optional(v.number()),
    withDetail: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ImportResult> => {
    const country = args.country.toLowerCase();
    const result: ImportResult = { fetched: 0, created: 0, updated: 0, errors: [], totalAvailable: 0 };
    if (!(NEXSCOPE_TIKTOK_COUNTRIES as readonly string[]).includes(country)) {
      result.errors.push(`Nexscope TikTok ads don't cover "${args.country}". Use one of: ${NEXSCOPE_TIKTOK_COUNTRIES.join(", ")}`);
      return result;
    }
    const maxPages = Math.min(10, Math.max(1, args.maxPages ?? 3));
    const withDetail = args.withDetail ?? true;

    for (let page = 1; page <= maxPages; page++) {
      let search: any;
      try {
        search = await runSkill("chuhaijiang-tiktok-ad-search", {
          country,
          keyword: args.keyword,
          page,
          pageSize: 10,
          sort: "gmv:desc",
        });
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
      const items: any[] = search?.data?.items ?? [];
      result.totalAvailable = num(search?.data?.total_count) ?? result.totalAvailable;
      if (!items.length) break;
      result.fetched += items.length;

      for (const it of items) {
        let detail: any = {};
        let core: any = {};
        if (withDetail && it.id) {
          try {
            const d = await runSkill("chuhaijiang-tiktok-ad-detail", { country, id: String(it.id), include: "core" });
            detail = d?.data?.items?.[0] ?? {};
            core = d?.data?.core?.items?.[0] ?? {};
          } catch (e) {
            if (result.errors.length < 10) result.errors.push(`detail ${it.id}: ${e instanceof Error ? e.message : e}`);
          }
        }
        const d = { ...it, ...detail };
        const views = num(core.core_video_play_count) ?? num(d.video_play_count) ?? 0;
        const likes = num(core.core_video_like_count) ?? num(d.video_like_count) ?? 0;
        const days = num(core.core_ad_day_count) ?? num(d.ad_day_count) ?? 0;
        const gmv = num(core.core_total_gmv) ?? num(d.total_gmv) ?? 0;
        const maxCost = num(core.core_ad_maximum_cost) ?? num(d.ad_maximum_cost);
        const title = String(d.ad_title || d.product_title || "TikTok ad").slice(0, 500);
        try {
          const outcome = await ctx.runMutation(internal.sources.links.upsertExternalAd, {
            externalId: `tiktok_${d.video_id || d.id}`,
            source: "nexscope",
            advertiserName: String(d.advertiser_name || "Unknown advertiser").slice(0, 200),
            platform: "TikTok",
            country: country.toUpperCase(),
            niche: classifyNiche(
              { title, body: String(d.product_title ?? ""), url: String(d.web_url || ""), advertiser: String(d.advertiser_name ?? "") },
              args.niche,
            ),
            headline: title,
            bodyText: [d.product_title && d.product_title !== title ? d.product_title : "", gmv ? `GMV ${money(gmv)}` : ""]
              .filter(Boolean)
              .join(" · "),
            creativeUrl: imgUrl(d.ad_cover) || imgUrl(d.advertiser_avatar),
            landingPageUrl: String(d.web_url || d.ad_url || ""),
            spendEstimate: maxCost ? `up to ${money(maxCost)} (Nexscope est.)` : "Unknown",
            likes: Math.round(likes),
            views: compact(views),
            daysRunning: Math.round(days),
            aiScore: score(views, days, gmv),
            firstSeenAt: toIso(d.ad_create_time || d.create_time),
            mediaType: "video",
            ...(imgUrl(d.advertiser_avatar) ? { advertiserAvatar: imgUrl(d.advertiser_avatar) } : {}),
            ...(d.button_text ? { ctaText: String(d.button_text) } : {}),
            ...(views ? { impressions: Math.round(views) } : {}),
            ...(num(core.core_video_comment_count) !== undefined ? { comments: Math.round(num(core.core_video_comment_count)!) } : {}),
            ...(num(core.core_video_share_count) !== undefined ? { shares: Math.round(num(core.core_video_share_count)!) } : {}),
            ...(d.last_update_time ? { lastSeenAt: toIso(d.last_update_time) } : {}),
            countries: [country.toUpperCase()],
            ...(d.ad_url ? { adLibraryUrl: String(d.ad_url) } : {}),
          });
          if (outcome === "created") result.created += 1;
          else result.updated += 1;
        } catch (e) {
          if (result.errors.length < 10) result.errors.push(`save ${d.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (items.length < 10 || (result.totalAvailable && page * 10 >= result.totalAvailable)) break;
    }
    return result;
  },
});

export const importTikTokAdsNow = action({
  args: { country: v.string(), keyword: v.string(), niche: v.string(), maxPages: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ImportResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    return await ctx.runAction(internal.nexscope.tiktokAds.importTikTokAds, args);
  },
});

// Daily: only runs when NEXSCOPE_TIKTOK_COUNTRIES is set (e.g. "gb,de"), one
// page (10 ads + details) per niche per country, to keep Nexscope credits predictable.
export const dailyTikTokImport = internalAction({
  args: {},
  handler: async (ctx) => {
    const countries = (process.env.NEXSCOPE_TIKTOK_COUNTRIES ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    for (const country of countries) {
      for (const { niche, keyword } of NICHE_KEYWORDS) {
        await ctx.runAction(internal.nexscope.tiktokAds.importTikTokAds, { country, keyword, niche, maxPages: 1 });
      }
    }
    return null;
  },
});

// ── Shopify stores that advertise ──────────────────────────────────────────

type StoreResult = { fetched: number; created: number; updated: number; errors: string[] };

function range(n: number | undefined, unit: string): string {
  if (!n) return "Unknown";
  const lo = Math.round(n * 0.8);
  const hi = Math.round(n * 1.2);
  const f = (x: number) => (x >= 1_000_000 ? `${(x / 1_000_000).toFixed(1)}M` : x >= 1000 ? `${Math.round(x / 1000)}K` : `${x}`);
  return `${f(lo)}–${f(hi)} ${unit}`;
}

export const importShopifyStores = internalAction({
  args: { country: v.string(), niche: v.string(), searchKey: v.optional(v.string()), minAds: v.optional(v.number()), maxPages: v.optional(v.number()) },
  handler: async (ctx, args): Promise<StoreResult> => {
    const result: StoreResult = { fetched: 0, created: 0, updated: 0, errors: [] };
    const maxPages = Math.min(10, Math.max(1, args.maxPages ?? 2));
    for (let page = 1; page <= maxPages; page++) {
      let res: any;
      try {
        res = await runSkill("shopify-store-query", {
          country: args.country.toUpperCase(),
          ...(args.searchKey ? { searchKey: args.searchKey } : {}),
          advertiseCountMin: args.minAds ?? 1,
          page,
          pageSize: 20,
        });
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
      const stores: any[] = res?.stores ?? [];
      if (!stores.length) break;
      result.fetched += stores.length;
      for (const s of stores) {
        const domain = String(s.storeDomain || "").toLowerCase();
        const url = String(s.storeLink || (domain ? `https://${domain}` : ""));
        if (!url) continue;
        const visits = num(s.monthlyVisit);
        const orders = num(s.monthOrderNum);
        try {
          const outcome = await ctx.runMutation(internal.sources.links.upsertExternalStore, {
            externalId: `shopify:${domain || s.shopId || s.storeId}`,
            source: "nexscope",
            name: String(s.storeName || domain || "Shopify store").slice(0, 200),
            url,
            logoUrl: String(s.logo || ""),
            niche: args.niche,
            country: String(s.country || args.country).toUpperCase().slice(0, 2),
            estimatedRevenueRange: orders ? range(orders, "orders/mo") : "Unknown",
            trafficRange: range(visits, "visits/mo"),
            activeAdsCount: Math.round(num(s.advertiseCount) ?? 0),
            isHighTraffic: (visits ?? 0) >= 50_000,
          });
          if (outcome === "created") result.created += 1;
          else result.updated += 1;
        } catch (e) {
          if (result.errors.length < 10) result.errors.push(`save ${domain}: ${e instanceof Error ? e.message : e}`);
        }
      }
      const totalPage = num(res.totalPage);
      if (stores.length < 20 || (totalPage && page >= totalPage)) break;
    }
    return result;
  },
});

export const importShopifyStoresNow = action({
  args: { country: v.string(), niche: v.string(), searchKey: v.optional(v.string()), minAds: v.optional(v.number()) },
  handler: async (ctx, args): Promise<StoreResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    return await ctx.runAction(internal.nexscope.tiktokAds.importShopifyStores, args);
  },
});
