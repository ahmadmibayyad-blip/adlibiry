import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { pipiRowToAd } from "./lib/pipispyTransform";
import { requireAdmin } from "./admin/helpers";

// PiPiSpy open API (pipispy.com). One endpoint for everything:
//   POST https://www.pipispy.com/open-api/v1/data  { key, uri, params }
// Every result costs 1 credit, so every run is capped. Env:
//   PIPISPY_API_KEY          required
//   PIPISPY_MAX_PER_RUN      max ads (= credits) one import may use, default 100
//   PIPISPY_COUNTRIES        e.g. "DK,SE" — turns on the daily import (off when unset)
//   PIPISPY_DAILY_PER_COUNTRY  ads per country per day, default 50
const ENDPOINT = "https://www.pipispy.com/open-api/v1/data";
const PAGE = 50; // PiPiSpy's max page size

type Reply = { code?: number; message?: string; data?: { data?: unknown[]; page?: { is_next?: boolean } }; remaining_credits?: number; consumed_credits?: number };

async function callPipi(uri: string, params: Record<string, unknown>): Promise<Reply> {
  const key = process.env.PIPISPY_API_KEY;
  if (!key) throw new ConvexError({ code: "NOT_CONFIGURED", message: "Add PIPISPY_API_KEY in Convex → Settings → Environment Variables" });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ key, uri, params }),
  });
  const text = await res.text();
  let json: Reply;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`PiPiSpy HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  if (json.code === 401 || res.status === 401) throw new Error("PiPiSpy rejected the API key (401). Check PIPISPY_API_KEY.");
  if (!res.ok || json.code !== 200) throw new Error(`PiPiSpy error ${json.code ?? res.status}: ${json.message ?? text.slice(0, 160)}`);
  return json;
}

const errorText = (e: unknown) =>
  e instanceof ConvexError ? String((e.data as { message?: string })?.message ?? e.data) : e instanceof Error ? e.message : String(e);

export const saveCredits = internalMutation({
  args: { remaining: v.number() },
  handler: async (ctx, { remaining }) => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "pipispy")).unique();
    const now = new Date().toISOString();
    const data = { remainingCredits: remaining, checkedAt: now };
    if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt: now });
    else await ctx.db.insert("siteStats", { key: "pipispy", data, updatedAt: now });
    return null;
  },
});

export const creditsStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "pipispy")).unique();
    return (doc?.data as { remainingCredits: number; checkedAt: string } | undefined) ?? null;
  },
});

const importArgs = {
  country: v.string(), // ISO2, e.g. "DK"
  keyword: v.optional(v.string()),
  platform: v.optional(v.string()), // "tiktok" | "facebook" | undefined = both
  maxAds: v.optional(v.number()),
  sort: v.optional(v.number()), // PiPiSpy sort code; default 4 = most plays
  activeOnly: v.optional(v.boolean()),
  niche: v.optional(v.string()), // fallback niche when an ad's own text is unclear
};

type ImportResult = { fetched: number; created: number; updated: number; skipped: number; creditsUsed: number; creditsRemaining?: number; errors: string[] };

export const importAds = internalAction({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportResult> => {
    const r: ImportResult = { fetched: 0, created: 0, updated: 0, skipped: 0, creditsUsed: 0, errors: [] };
    const cap = Math.max(1, Number(process.env.PIPISPY_MAX_PER_RUN ?? 100) || 100);
    const want = Math.min(Math.max(1, Math.round(args.maxAds ?? 50)), cap);
    if ((args.maxAds ?? 0) > cap) r.errors.push(`Limited to ${cap} ads (PIPISPY_MAX_PER_RUN) — each ad costs 1 credit.`);
    const country = args.country.trim().toUpperCase();

    for (let page = 1; r.fetched < want; page++) {
      let reply: Reply;
      try {
        reply = await callPipi("/v3/api/open/adspy/list", {
          current_page: page,
          page_size: Math.min(PAGE, want - r.fetched),
          region: [country],
          ...(args.platform === "tiktok" ? { plat_type: 1 } : args.platform === "facebook" ? { plat_type: 2 } : {}),
          ...(args.keyword?.trim() ? { extend_keywords: [{ type: 1, keyword: args.keyword.trim() }] } : {}),
          ...(args.activeOnly ? { ad_state: 1 } : {}),
          sort: args.sort ?? 4,
          sort_type: "desc",
        });
      } catch (e) {
        r.errors.push(errorText(e));
        break;
      }
      r.creditsUsed += reply.consumed_credits ?? 0;
      if (typeof reply.remaining_credits === "number") r.creditsRemaining = reply.remaining_credits;
      const rows = Array.isArray(reply.data?.data) ? (reply.data!.data as Record<string, unknown>[]) : [];
      if (!rows.length) {
        if (page === 1) r.errors.push(`PiPiSpy found no ads for ${country}${args.keyword ? ` matching "${args.keyword}"` : ""}.`);
        break;
      }
      r.fetched += rows.length;
      const ads = rows
        .map((row) => pipiRowToAd(row, { preferCountries: [country], fallbackNiche: args.niche }))
        .filter((a): a is NonNullable<typeof a> => a !== null);
      r.skipped += rows.length - ads.length;
      for (let i = 0; i < ads.length; i += 25) {
        const res = await ctx.runMutation(internal.admin.externalImport.importAdsInternal, { ads: ads.slice(i, i + 25) });
        r.created += res.created;
        r.updated += res.updated;
      }
      if (!reply.data?.page?.is_next) break;
    }
    if (r.creditsRemaining !== undefined) await ctx.runMutation(internal.pipispy.saveCredits, { remaining: r.creditsRemaining });
    return r;
  },
});

export const importNow = action({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    return await ctx.runAction(internal.pipispy.importAds, args);
  },
});

// Key + balance check. The balance comes back with every data call; a
// 1-result search is the cheapest documented way to read it (1 credit).
export const checkKeyNow = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; remainingCredits?: number; error?: string }> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    if (!process.env.PIPISPY_API_KEY) return { configured: false };
    try {
      const reply = await callPipi("/v3/api/open/adspy/list", { current_page: 1, page_size: 1 });
      if (typeof reply.remaining_credits === "number") {
        await ctx.runMutation(internal.pipispy.saveCredits, { remaining: reply.remaining_credits });
      }
      return { configured: true, remainingCredits: reply.remaining_credits };
    } catch (e) {
      return { configured: true, error: errorText(e) };
    }
  },
});

// Daily: only when PIPISPY_COUNTRIES is set. Most-played active ads per
// country, capped by PIPISPY_DAILY_PER_COUNTRY (each ad = 1 credit).
export const dailyImport = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.PIPISPY_API_KEY) return null;
    const countries = (process.env.PIPISPY_COUNTRIES ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    const perCountry = Number(process.env.PIPISPY_DAILY_PER_COUNTRY ?? 50) || 50;
    for (const country of countries) {
      await ctx.runAction(internal.pipispy.importAds, { country, maxAds: perCountry, activeOnly: true });
    }
    return null;
  },
});
