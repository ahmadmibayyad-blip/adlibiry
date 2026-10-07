import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./admin/helpers";
import { backfillTerm, budgetLeft, entrantSpikes } from "./lib/fusion";
import { metaAdToExternal } from "./lib/metaAdLibrary";
import { searchMetaAds } from "./metaAdLibrary";
import { adLibraryUrl, runCostCap } from "./apify";
import { NICHE_KEYWORDS } from "./adlibrary/client";

// ── Event-driven enrichment across sources ──────────────────────────────────
// Run by the pipeline's "fusion" stage after the winners are rebuilt:
//   A. a product enters the winners list → Apify pulls that advertiser's ads
//      (spend goes where users look);
//   B. a niche × country suddenly draws new sellers → alert that niche's
//      watchers and send one Apify pass over the newcomers;
//   C. a marketplace product (sales, no ads) → one AdLibrary search for its
//      brand (or Meta's free official API without an AdLibrary key), so the
//      next run can link its ads.
// Apify runs count against APIFY_DAILY_BUDGET_USD (default 10), winners first,
// then spikes; each run reserves its cost cap until Apify reports the real cost.

const MAX_ADS = 50;
const ADLIBRARY_GAP_MS = Number(process.env.ADLIBRARY_GAP_MS ?? 6500);
const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const numEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};
const dailyBudget = () => numEnv("APIFY_DAILY_BUDGET_USD", 10);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type TriggerResult = { done: number; skipped?: string; errors: string[] };

export const runTriggers = internalAction({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const out: Record<"winner" | "spike" | "backfill", TriggerResult> = {
      winner: { done: 0, errors: [] },
      spike: { done: 0, errors: [] },
      backfill: { done: 0, errors: [] },
    };
    const apify = !!process.env.APIFY_TOKEN;
    let spent: number = await ctx.runQuery(internal.fusion.spentOn, { day: args.day });
    const cap = runCostCap(MAX_ADS, process.env.APIFY_MAX_RUN_USD);
    const canSpend = () => budgetLeft(spent, dailyBudget()) >= cap;

    // A. New winners → that advertiser's ads.
    try {
      const todo = await ctx.runQuery(internal.fusion.winnersToEnrich, { day: args.day, limit: numEnv("FUSION_ENRICH_PER_DAY", 10) });
      if (!apify && todo.length) out.winner.skipped = "APIFY_TOKEN isn't set";
      for (const w of apify ? todo : []) {
        if (!canSpend()) {
          out.winner.skipped = "daily Apify budget reached";
          break;
        }
        try {
          await ctx.runAction(internal.apify.startTrackedRun, {
            country: w.country,
            keyword: w.advertiser,
            niche: w.niche,
            maxAds: MAX_ADS,
            url: adLibraryUrl(w.country, w.advertiser, true),
            trigger: "winner",
            productId: w.productId,
          });
          spent += cap;
          out.winner.done++;
          await ctx.runMutation(internal.fusion.markEnriched, { id: w.productId, day: args.day });
        } catch (e) {
          out.winner.errors.push(`${w.advertiser}: ${errorText(e)}`.slice(0, 200));
        }
      }
    } catch (e) {
      out.winner.errors.push(errorText(e));
    }

    // B. Niche × country entrant spikes.
    try {
      const counts: Record<string, Set<string>> = {};
      let cursor: string | null = null;
      for (let page = 0; page < 40; page++) {
        const r: { rows: { key: string; advertiser: string }[]; cursor: string; isDone: boolean } = await ctx.runQuery(
          internal.fusion.adsSeenSince,
          { since: `${dayMinus(args.day, 7)}T00:00:00.000Z`, cursor },
        );
        for (const row of r.rows) (counts[row.key] ??= new Set()).add(row.advertiser);
        if (r.isDone) break;
        cursor = r.cursor;
      }
      const spikes = await ctx.runMutation(internal.fusion.recordAdvertisers, {
        day: args.day,
        counts: Object.fromEntries(Object.entries(counts).map(([k, s]) => [k, s.size])),
      });
      for (const s of spikes) {
        const [niche, country] = s.key.split("|");
        await ctx.runMutation(internal.notifications.notifyUsersWatchingNiche, {
          niche,
          type: "niche_spike",
          title: `${s.now - s.before} new sellers entered ${niche} in ${country} this week`,
          body: `Advertisers running ${niche} ads in ${country} went from ${s.before} to ${s.now} in 7 days.`,
          link: `/dashboard/ad-spy?niche=${encodeURIComponent(niche)}&country=${encodeURIComponent(country)}&firstSeen=7`,
        });
        out.spike.done++;
        if (!apify || !canSpend()) continue;
        try {
          const keyword = NICHE_KEYWORDS.find((k) => k.niche === niche)?.keyword ?? niche;
          await ctx.runAction(internal.apify.startTrackedRun, { country, keyword, niche, maxAds: MAX_ADS, trigger: "spike" });
          spent += cap;
        } catch (e) {
          out.spike.errors.push(`${s.key}: ${errorText(e)}`.slice(0, 200));
        }
      }
    } catch (e) {
      out.spike.errors.push(errorText(e));
    }

    // C. Marketplace products without ads → one targeted search: AdLibrary when
    // its key is set (one search credit each), else Meta's free official API.
    try {
      const countries = (process.env.META_AD_COUNTRIES ?? "DK,SE,DE,NL,FR").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
      const adLibrary = !!process.env.ADLIBRARY_API_KEY;
      if (!adLibrary && !process.env.META_ACCESS_TOKEN?.trim()) out.backfill.skipped = "neither ADLIBRARY_API_KEY nor META_ACCESS_TOKEN is set";
      else {
        const todo = await ctx.runQuery(internal.fusion.backfillCandidates, { day: args.day, limit: numEnv("FUSION_BACKFILL_PER_DAY", 20) });
        for (const [i, p] of todo.entries()) {
          const term = backfillTerm(p);
          if (adLibrary) {
            if (term.length >= 3) {
              // AdLibrary allows 10 requests a minute.
              if (i > 0) await new Promise((resolve) => setTimeout(resolve, ADLIBRARY_GAP_MS));
              const r = await ctx.runAction(internal.adlibrary.sync.searchKeyword, { keyword: term, niche: p.category });
              if (r?.error) {
                out.backfill.errors.push(`${term}: ${r.error}`.slice(0, 200));
                if (r.error.includes("402")) break; // out of credits: stop for today
              } else if (r?.found) out.backfill.done++;
            }
            await ctx.runMutation(internal.fusion.markBackfilled, { id: p._id, day: args.day });
            continue;
          }
          const r = term.length >= 3 ? await searchMetaAds(term, countries) : null;
          if (r && "error" in r) out.backfill.errors.push(`${term}: ${r.error}`.slice(0, 200));
          else if (r?.ads.length) {
            const now = Date.now();
            const saved = await ctx.runMutation(internal.sources.links.upsertExternalAds, {
              ads: r.ads.map((a) => metaAdToExternal(a, countries[0] ?? "INTL", p.category, now)),
            });
            out.backfill.errors.push(...saved.errors.slice(0, 3));
            out.backfill.done++;
          }
          await ctx.runMutation(internal.fusion.markBackfilled, { id: p._id, day: args.day });
        }
      }
    } catch (e) {
      out.backfill.errors.push(errorText(e));
    }

    await ctx.runMutation(internal.sourceConflicts.prune, { day: args.day });
    await ctx.runMutation(internal.fusion.saveLastRun, { day: args.day, result: out });
    return out;
  },
});

/** Apify money already committed today by triggered runs (real cost when known, else the run's cap). */
export const spentOn = internalQuery({
  args: { day: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const runs = await ctx.db.query("apifyRuns").withIndex("by_day", (q) => q.eq("day", args.day)).collect();
    return runs.filter((r) => r.trigger && r.trigger !== "daily").reduce((sum, r) => sum + (r.costUsd ?? r.capUsd ?? 0), 0);
  },
});

/** Winners never enriched: today's entries first, then the strongest; only those with a known advertiser. */
export const winnersToEnrich = internalQuery({
  args: { day: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("winningProducts").withIndex("by_position").take(1000);
    rows.sort((a, b) => Number(b.enteredDay === args.day) - Number(a.enteredDay === args.day) || b.score - a.score);
    const out: { productId: Id<"products">; niche: string; advertiser: string; country: string }[] = [];
    for (const r of rows) {
      if (out.length >= args.limit) break;
      const p = await ctx.db.get("products", r.productId);
      if (!p || p.enrichedAt) continue;
      const ads = (await Promise.all((p.adIds ?? []).slice(0, 30).map((id) => ctx.db.get("ads", id)))).filter((a) => a !== null);
      const best = ads.filter((a) => a.advertiserName && a.advertiserName !== "Unknown advertiser").sort((a, b) => b.aiScore - a.aiScore)[0];
      if (!best) continue;
      const country = p.saturationByCountry?.[0]?.country ?? (best.country && best.country !== "INTL" ? best.country : "US");
      out.push({ productId: p._id, niche: r.niche, advertiser: best.advertiserName, country });
    }
    return out;
  },
});

export const markEnriched = internalMutation({
  args: { id: v.id("products"), day: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.get("products", args.id)) await ctx.db.patch("products", args.id, { enrichedAt: args.day });
  },
});

/** One page of ads seen in the window, reduced to niche|country → advertiser. */
export const adsSeenSince = internalQuery({
  args: { since: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("ads")
      .withIndex("by_last_seen", (q) => q.gte("lastSeenAt", args.since))
      .paginate({ numItems: 1000, cursor: args.cursor });
    const rows: { key: string; advertiser: string }[] = [];
    for (const a of page.page) {
      const advertiser = a.advertiserName.trim().toLowerCase();
      if (!advertiser || advertiser === "unknown advertiser") continue;
      for (const c of new Set([a.country, ...(a.countries ?? [])])) {
        if (c && c !== "INTL") rows.push({ key: `${a.niche}|${c}`, advertiser });
      }
    }
    return { rows, cursor: page.continueCursor, isDone: page.isDone };
  },
});

type AdvertiserHistory = { days: Record<string, Record<string, number>>; alerted: Record<string, string> };

/** Stores today's counts (15 days kept) and returns up to 5 spikes not alerted in the last 7 days. */
export const recordAdvertisers = internalMutation({
  args: { day: v.string(), counts: v.record(v.string(), v.number()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "nicheAdvertisers")).unique();
    const data: AdvertiserHistory = (row?.data as AdvertiserHistory | undefined) ?? { days: {}, alerted: {} };
    data.days[args.day] = args.counts;
    for (const d of Object.keys(data.days)) if (d < dayMinus(args.day, 15)) delete data.days[d];
    // The week-ago reference: the newest day 7–9 days back.
    const ref = Object.keys(data.days)
      .filter((d) => d <= dayMinus(args.day, 7) && d >= dayMinus(args.day, 9))
      .sort()
      .pop();
    const spikes = (ref ? entrantSpikes(args.counts, data.days[ref]) : [])
      .filter((s) => !data.alerted[s.key] || data.alerted[s.key] < dayMinus(args.day, 7))
      .slice(0, 5);
    for (const s of spikes) data.alerted[s.key] = args.day;
    for (const [k, d] of Object.entries(data.alerted)) if (d < dayMinus(args.day, 30)) delete data.alerted[k];
    const updatedAt = new Date().toISOString();
    if (row) await ctx.db.patch("siteStats", row._id, { data, updatedAt });
    else await ctx.db.insert("siteStats", { key: "nicheAdvertisers", data, updatedAt });
    return spikes;
  },
});

const MARKETPLACE_SOURCES = ["tiktok_shop", "shopify", "nexscope_api"] as const;

/** Marketplace products with sales and no linked ads, best sellers first; each re-checked every 14 days at most. */
export const backfillCandidates = internalQuery({
  args: { day: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const recheck = dayMinus(args.day, 14);
    const found: { _id: Id<"products">; title: string; storeHost?: string; category: string; units: number }[] = [];
    for (const source of MARKETPLACE_SOURCES) {
      const rows = await ctx.db
        .query("products")
        .withIndex("by_source_units", (q) => q.eq("source", source).gt("unitsPerMonth", 0))
        .order("desc")
        .take(300);
      for (const p of rows) {
        if ((p.linkedAds ?? 0) > 0 || (p.backfillCheckedAt && p.backfillCheckedAt > recheck)) continue;
        found.push({ _id: p._id, title: p.title, storeHost: p.storeHost, category: p.category, units: p.unitsPerMonth ?? 0 });
      }
    }
    return found.sort((a, b) => b.units - a.units).slice(0, args.limit);
  },
});

export const markBackfilled = internalMutation({
  args: { id: v.id("products"), day: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.get("products", args.id)) await ctx.db.patch("products", args.id, { backfillCheckedAt: args.day });
  },
});

export const saveLastRun = internalMutation({
  args: { day: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fusionLastRun")).unique();
    const data = { day: args.day, ...(args.result as object) };
    const updatedAt = new Date().toISOString();
    if (row) await ctx.db.patch("siteStats", row._id, { data, updatedAt });
    else await ctx.db.insert("siteStats", { key: "fusionLastRun", data, updatedAt });
  },
});

/** Admin → Source fusion: Apify spend per trigger (7 days), budget, the last run and how many winners are verified. */
export const adminSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const spend: Record<string, { runs: number; usd: number }> = {};
    let spentToday = 0;
    for (let i = 0; i < 7; i++) {
      const day = dayMinus(today, i);
      for (const r of await ctx.db.query("apifyRuns").withIndex("by_day", (q) => q.eq("day", day)).collect()) {
        const t = r.trigger ?? "daily";
        const usd = r.costUsd ?? r.capUsd ?? 0;
        spend[t] = { runs: (spend[t]?.runs ?? 0) + 1, usd: Math.round(((spend[t]?.usd ?? 0) + usd) * 100) / 100 };
        if (i === 0 && t !== "daily") spentToday += usd;
      }
    }
    const winners = await ctx.db.query("winningProducts").withIndex("by_position").take(1000);
    let verified = 0;
    let multiSource = 0;
    for (const w of winners) {
      const p = await ctx.db.get("products", w.productId);
      if (p?.verifiedWinner) verified++;
      if ((p?.fusion?.families.length ?? 0) >= 2) multiSource++;
    }
    const last = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fusionLastRun")).unique();
    return {
      budget: dailyBudget(),
      spentToday: Math.round(spentToday * 100) / 100,
      spend: Object.entries(spend).map(([trigger, s]) => ({ trigger, ...s })),
      winners: winners.length,
      verified,
      multiSource,
      lastRun: (last?.data ?? null) as null | ({ day: string } & Partial<Record<"winner" | "spike" | "backfill", TriggerResult>>),
    };
  },
});
