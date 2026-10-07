import { estimateProduct, pointEstimate, unitsPerMonthFromText } from "./lib/estimates";
import { HISTOGRAM_BINS, binOf, medianOf, percentileOf, rawScore, scoreFromPercentile, scoreParts, shareAtLeast } from "./lib/productScore";
import { passesKnownGates, passesWinnerGates } from "./lib/winnerGates";
import { fusion, isVerifiedWinner } from "./lib/fusion";
import { cleanAdCopy } from "./lib/adCopy";
import { engagementRate, isScaling } from "./lib/scaling";
import { upgradeDescription } from "./lib/productCopy";
import { factorFor, type BasisCalibration } from "./lib/revenueModel";
import { readCalibration } from "./revenueTruth";
import { productFollowAlerts, storeAdAlerts } from "./follows";

type Calibrations = Record<string, BasisCalibration> | undefined;
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { markStatsDirty } from "./stats";
import { requireAdmin } from "./admin/helpers";
import { NICHES } from "./lib/category";
import { parseRangeUpperBound } from "./lib/rangeParsing";
import { priceFromAdText, priceLabel, toUsd } from "./lib/priceParse";
import {
  adSellsProduct, gmvFromText, parseCompact, productFlags, productTitleForAd, roundRobin, saturationFromCompetition, titleKey, urlKey, isProductPage,
  SAME_TITLE_MIN, storeHost, titleSimilarity,
} from "./lib/productMatch";
import { shouldWriteSnapshot } from "./lib/snapshots";
import { hashBands, isSameImage, isUsableHash, productHashFields } from "./lib/imageHash";
import { WINNERS_ROUND_DAYS, addDays, daysBetween, pickNicheMix } from "./lib/winnerMix";

// ── Daily pipeline ──────────────────────────────────────────────────────────
// Runs once a day after the imports (see crons.ts), as a chain of small,
// re-runnable steps in this order:
//   hashImages     – image hashes for new products and ads (action)
//   keys           – matching keys, hide-flags, margin, copy fixes
//   link           – every ad that sells a physical product is attached to one
//                    product (landing page, title, image, same store + title)
//   landingPages   – prices read from product landing pages (action)
//   dedupe         – products imported twice are merged into one
//   stores         – Shopify store catalog checks are queued (they run alongside)
//   aggregate      – each product adds up its ads and gets its score parts
//   calibrate…     – scores ranked across the catalog (model v2)
//   winners        – Winning Products: score 65+ and the winner gates; a new
//                    mix every 3 days, other days only drop-outs are removed
//   snapshots      – one history row per product and per ad for today
//   prune          – history older than 90 days is removed
//   alerts         – Pro follow alerts: advertisers with new ads, followed
//                    products with new ads or a score past the threshold
//   lists          – Research tab and site counts rebuilt from today's data
//   emails         – the morning digest is queued
// Each step logs when it started (siteStats["productPipeline"].log); Admin
// shows the run and can re-run it from any step.

export const WINNER_MIN_SCORE = 65;
export const WINNERS_PER_NICHE = 50;
const KEEP_DAYS = 90;
const MAX_ADS_PER_PRODUCT = 200;
const MAX_WINNER_CANDIDATES = 400; // per niche, so one mutation stays within read limits

export const STAGES = [
  "hashImages", "keys", "link", "landingPages", "dedupe", "stores", "aggregate", "calibrateScan", "calibrateApply",
  "winners", "fusion", "snapshotProducts", "snapshotAds", "prune", "alerts", "storeAds", "lists", "emails",
] as const;
type Stage = (typeof STAGES)[number] | "done";
const NEXT: Record<Stage, Stage> = {
  hashImages: "keys",
  keys: "link",
  link: "landingPages",
  landingPages: "dedupe",
  dedupe: "stores",
  stores: "aggregate",
  aggregate: "calibrateScan",
  calibrateScan: "calibrateApply",
  calibrateApply: "winners",
  winners: "fusion",
  fusion: "snapshotProducts",
  snapshotProducts: "snapshotAds",
  snapshotAds: "prune",
  prune: "alerts",
  alerts: "storeAds",
  storeAds: "lists",
  lists: "emails",
  emails: "done",
  done: "done",
};
// Steps that hand off to an action and continue when it reports back (actionDone).
const ACTION_STAGES = new Set<Stage>(["hashImages", "landingPages"]);
const STUCK_MS = 3 * 3_600_000; // a run with no progress for 3 hours is considered dead
const STALL_MS = 20 * 60_000; // watchdog: a step with no progress this long failed
const ACTION_STALL_MS = 90 * 60_000; // image hashes / landing pages run long

type Status = {
  state: "running" | "done" | "error";
  stage: Stage;
  day: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  counts: { productsCreated: number; adsLinked: number; winners: number; snapshots: number; pruned: number; winnersGated?: number; merged?: number };
  calib?: Calibration;
  log?: { stage: Stage; at: string; note?: string }[]; // when each step started
  updatedAt?: string;
  // Id of this run: steps of an older (stopped / restarted) run quit.
  runId?: string;
  // Steps that failed or stalled; the run skipped them and went on.
  warnings?: string[];
  forceWinners?: boolean; // an admin's Run now: draw a new Winning Products mix today
};

// Score calibration state carried between steps: the histogram of raw scores,
// live scores before and v2 scores after (0–100), and the top 20 under v2.
type Calibration = {
  hist: number[];
  before: number[];
  after: number[];
  top: { id: string; title: string; old: number; next: number }[];
};
const zeros = (n: number) => new Array<number>(n).fill(0);
const score100 = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

// Per-niche median engagement from the last site-stats run (convex/stats.ts).
async function engagementMedians(ctx: MutationCtx): Promise<Record<string, number>> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
  return (doc?.data as { ads?: { engagementMedians?: Record<string, number> } } | undefined)?.ads?.engagementMedians ?? {};
}

// Which score model is live: "v1" (old per-source scores) until an admin
// switches to "v2" after reviewing the calibration report.
async function scoreModel(ctx: MutationCtx): Promise<"v1" | "v2"> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "scoreModel")).unique();
  return (doc?.data as { model?: string } | undefined)?.model === "v2" ? "v2" : "v1";
}

const today = () => new Date().toISOString().slice(0, 10);

// Whole days between our first and last sighting of an ad (0 if unknown).
export function observedDays(firstSeenAt: string, lastSeenAt: string | undefined): number {
  const first = Date.parse(firstSeenAt);
  const last = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  return Number.isFinite(first) && Number.isFinite(last) && last > first ? Math.floor((last - first) / 86_400_000) : 0;
}
const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

async function readStatus(ctx: MutationCtx): Promise<{ id: Id<"siteStats">; data: Status } | null> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
  return doc ? { id: doc._id, data: doc.data as Status } : null;
}

async function writeStatus(ctx: MutationCtx, data: Status) {
  const doc = await readStatus(ctx);
  const updatedAt = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc.id, { data, updatedAt });
  else await ctx.db.insert("siteStats", { key: "productPipeline", data, updatedAt });
}

// One run at a time. A run with no progress for STUCK_MS is considered dead;
// for an admin's Run now / Run from, already after the watchdog's stall limit
// (the old run's steps then see a different runId and quit).
async function begin(ctx: MutationCtx, from: Stage = "hashImages", byAdmin = false): Promise<boolean> {
  const current = await readStatus(ctx);
  const lastProgress = current?.data.updatedAt ?? current?.data.startedAt;
  const deadAfter = !byAdmin ? STUCK_MS : ACTION_STAGES.has(current?.data.stage ?? "done") ? ACTION_STALL_MS : STALL_MS;
  if (current?.data.state === "running" && lastProgress && Date.now() - Date.parse(lastProgress) < deadAfter) return false;
  const day = today();
  const now = new Date().toISOString();
  const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  await writeStatus(ctx, {
    state: "running",
    stage: from,
    day,
    startedAt: now,
    updatedAt: now,
    runId,
    ...(byAdmin ? { forceWinners: true } : {}),
    counts: { productsCreated: 0, adsLinked: 0, winners: 0, snapshots: 0, pruned: 0 },
    log: [{ stage: from, at: now }],
  });
  await ctx.scheduler.runAfter(0, internal.productPipeline.step, { stage: from, cursor: null, day, runId });
  return true;
}

// Admin: re-run the pipeline from one step (each step is safe to repeat).
export const runFrom = mutation({
  args: { stage: v.union(...STAGES.map((s) => v.literal(s))) },
  handler: async (ctx, args): Promise<{ started: boolean }> => {
    await requireAdmin(ctx);
    return { started: await begin(ctx, args.stage, true) };
  },
});

// An action step (image hashes, landing pages) reports back: move on.
export const actionDone = internalMutation({
  args: { day: v.string(), stage: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const status = await readStatus(ctx);
    if (!status || status.data.state !== "running" || status.data.day !== args.day || status.data.stage !== args.stage) return;
    await advance(ctx, status.data, status.data.counts, status.data.calib, args.stage as Stage, args.note);
  },
});

async function advance(ctx: MutationCtx, data: Status, counts: Status["counts"], calib: Calibration | undefined, stage: Stage, note?: string) {
  const nextStage = NEXT[stage];
  const now = new Date().toISOString();
  const log = [...(data.log ?? []).map((l) => (l.stage === stage && note && !l.note ? { ...l, note } : l))];
  if (nextStage === "done") {
    await writeStatus(ctx, { ...data, counts, calib: undefined, log: [...log, { stage: "done", at: now }], stage: "done", state: "done", updatedAt: now, finishedAt: now });
    return;
  }
  await writeStatus(ctx, { ...data, counts, calib, log: [...log, { stage: nextStage, at: now }].slice(-40), stage: nextStage, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.productPipeline.step, { stage: nextStage, cursor: null, day: data.day, runId: data.runId });
}

// A step that failed or stalled is skipped: note it and go on, so one broken
// step (e.g. duplicate merging) never keeps linking and winners from running.
async function skipStage(ctx: MutationCtx, data: Status, stage: Stage, why: string) {
  const warning = `${PIPELINE_STAGE_NAMES[stage] ?? stage}: ${why}`.slice(0, 300);
  await advance(ctx, { ...data, warnings: [...(data.warnings ?? []), warning].slice(-10) }, data.counts, data.calib, stage, why.slice(0, 120));
}
const PIPELINE_STAGE_NAMES: Partial<Record<Stage, string>> = { dedupe: "Merging duplicates", link: "Linking ads", winners: "Winning Products" };

// Every 10 minutes (crons.ts): a running step with no progress for a while
// failed without reporting back (e.g. it hit a Convex limit). Skip it.
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const status = await readStatus(ctx);
    if (status?.data.state === "running") {
      const last = Date.parse(status.data.updatedAt ?? status.data.startedAt);
      const limit = ACTION_STAGES.has(status.data.stage) ? ACTION_STALL_MS : STALL_MS;
      if (Date.now() - last > limit) {
        await skipStage(ctx, status.data, status.data.stage, `no progress for ${Math.round((Date.now() - last) / 60_000)} min, skipped`);
      }
    }
    // Duplicate merging started from Admin: a failed page leaves it "running".
    const dedup = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productDedup")).unique();
    const d = dedup?.data as DedupStatus | undefined;
    if (dedup && d?.state === "running" && Date.now() - Date.parse(dedup.updatedAt) > STALL_MS) {
      await writeDedup(ctx, { ...d, state: "stalled", finishedAt: new Date().toISOString() });
    }
  },
});

// Admin: stop a running pipeline. The next step sees it isn't "running" and
// quits (see step); whatever steps already ran stay done.
export const stop = mutation({
  args: {},
  handler: async (ctx): Promise<{ stopped: boolean }> => {
    await requireAdmin(ctx);
    const status = await readStatus(ctx);
    if (status?.data.state !== "running") return { stopped: false };
    const now = new Date().toISOString();
    await writeStatus(ctx, { ...status.data, state: "error", error: `Stopped by an admin at "${status.data.stage}"`, updatedAt: now, finishedAt: now });
    return { stopped: true };
  },
});

export const start = internalMutation({ args: {}, handler: async (ctx) => void (await begin(ctx)) });

export const runNow = mutation({
  args: {},
  handler: async (ctx): Promise<{ started: boolean }> => {
    await requireAdmin(ctx);
    return { started: await begin(ctx, "hashImages", true) };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
    return (doc?.data as Status | undefined) ?? null;
  },
});

// ── Pure helpers (exported for tests) ──────────────────────────────────────

export function adNumbers(ad: Doc<"ads">) {
  return {
    views: ad.impressions ?? parseCompact(ad.views) ?? 0,
    likes: ad.likes ?? 0,
    comments: ad.comments ?? 0,
    spend: parseRangeUpperBound(ad.spendEstimate ?? "") ?? 0,
    gmv: ad.gmv ?? gmvFromText(ad.bodyText ?? "") ?? 0,
  };
}

function productText(p: Pick<Doc<"products">, "title" | "description" | "tags">) {
  return `${p.title} ${p.description.slice(0, 400)} ${p.tags.join(" ")}`;
}

// ── Steps ───────────────────────────────────────────────────────────────────

export const step = internalMutation({
  args: { stage: v.string(), cursor: v.union(v.string(), v.null()), day: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stage = args.stage as Stage;
    const status = await readStatus(ctx);
    if (!status || status.data.state !== "running" || status.data.day !== args.day) return; // cancelled or superseded
    if (status.data.runId && args.runId !== status.data.runId) return; // a step of an older run
    const counts = { ...status.data.counts };
    let calib = status.data.calib;
    let done = true;
    let cursor: string | null = null;

    try {
      if (ACTION_STAGES.has(stage)) {
        // Hand off to the action; it calls actionDone when it has finished.
        if (args.cursor === null) {
          if (stage === "hashImages") {
            await ctx.scheduler.runAfter(0, internal.imageHashAction.hashMissing, { cursor: null, productsDone: false, round: 0, pipelineDay: args.day });
          } else {
            await ctx.scheduler.runAfter(0, internal.priceFetch.run, { round: 0, pipelineDay: args.day });
          }
        }
        return;
      } else if (stage === "dedupe") {
        const r = await mergePage(ctx, args.cursor);
        counts.merged = (counts.merged ?? 0) + r.merged;
        done = r.isDone;
        cursor = r.cursor;
      } else if (stage === "stores") {
        // Store catalog checks run alongside the rest (each store is its own
        // action, spaced out to stay polite); nothing later depends on them.
        await ctx.scheduler.runAfter(0, internal.storeSales.runAll, {});
      } else if (stage === "alerts") {
        // Advertiser alerts run as their own batches; product follows page here.
        if (args.cursor === null) await ctx.scheduler.runAfter(0, internal.follows.sendDailyAlerts, {});
        const r = await productFollowAlerts(ctx, args.cursor);
        done = r.isDone;
        cursor = r.cursor;
      } else if (stage === "storeAds") {
        // Watched stores that launched new ads since the last run.
        const r = await storeAdAlerts(ctx, args.cursor, args.day);
        done = r.isDone;
        cursor = r.cursor;
      } else if (stage === "lists") {
        await ctx.scheduler.runAfter(0, internal.research.rebuild, {});
        await ctx.scheduler.runAfter(0, internal.stats.recompute, {});
      } else if (stage === "emails") {
        // Whoever's local morning it is gets theirs now; the rest at their 8:00 (hourly cron).
        await ctx.scheduler.runAfter(0, internal.emailSender.sendMorningDigests, {});
      } else if (stage === "keys") {
        const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: args.cursor });
        for (const p of page.page) {
          const flags = productFlags(productText(p));
          const pageUrl = [p.storeUrl, p.supplierUrl].find((u) => isProductPage(u));
          const margin =
            p.price !== undefined && p.cost !== undefined && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined;
          const next = {
            description: upgradeDescription(p.description),
            urlKey: urlKey(pageUrl) ?? undefined,
            titleKey: titleKey(p.title) ?? undefined,
            storeHost: storeHost(p.storeUrl || p.supplierUrl) ?? undefined,
            marginPercent: margin,
            ...flags,
          };
          if ((Object.keys(next) as (keyof typeof next)[]).some((k) => p[k] !== next[k])) await ctx.db.patch("products", p._id, next);
        }
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "link") {
        const page = await ctx.db.query("ads").paginate({ numItems: 150, cursor: args.cursor });
        let created = 0;
        for (const ad of page.page) {
          // Which shop the ad sends people to (ties ads to tracked stores).
          const host = storeHost(ad.landingPageUrl) ?? undefined;
          if (ad.landingHost !== host) await ctx.db.patch("ads", ad._id, { landingHost: host });
          // Days running from our own history too: first sighting → last sighting.
          const observed = observedDays(ad.firstSeenAt, ad.lastSeenAt);
          if (observed > ad.daysRunning) {
            await ctx.db.patch("ads", ad._id, { daysRunning: observed });
            ad.daysRunning = observed;
          }
          // Older ads still carry page metadata in their copy: clean it once.
          const copy = cleanAdCopy(ad.bodyText);
          if (copy.text !== ad.bodyText || (copy.cta && !ad.ctaText)) {
            await ctx.db.patch("ads", ad._id, { bodyText: copy.text, ...(copy.cta && !ad.ctaText ? { ctaText: copy.cta } : {}) });
            ad.bodyText = copy.text;
          }
          const r = await linkAd(ctx, ad);
          if (r === "created") created++;
          if (r !== "skipped") counts.adsLinked++;
        }
        counts.productsCreated += created;
        if (created) await markStatsDirty(ctx);
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "aggregate") {
        // Each product loads up to MAX_ADS_PER_PRODUCT (200) full ads, so 10 per
        // step reads at most ~2,000 ads, well inside a mutation's 16 MiB limit
        // (40 per step could reach 8,000).
        const page = await ctx.db.query("products").paginate({ numItems: 10, cursor: args.cursor });
        const model = await scoreModel(ctx);
        const factors = await readCalibration(ctx);
        for (const p of page.page) {
          if (p.adIds?.length || p.linkedAds) await aggregate(ctx, p, args.day, model, factors);
          else await applyEstimates(ctx, p, factors);
        }
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "calibrateScan") {
        // Histogram of every product's raw v2 score (and of the live scores).
        calib ??= { hist: zeros(HISTOGRAM_BINS), before: zeros(101), after: zeros(101), top: [] };
        const page = await ctx.db.query("products").paginate({ numItems: 500, cursor: args.cursor });
        for (const p of page.page) {
          if (!p.scoreParts) continue;
          calib.hist[binOf(p.scoreParts.raw)]++;
          calib.before[score100(p.aiScore)]++;
        }
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "calibrateApply") {
        // Each product's percentile → its v2 score; live in aiScore under v2.
        calib ??= { hist: zeros(HISTOGRAM_BINS), before: zeros(101), after: zeros(101), top: [] };
        const model = await scoreModel(ctx);
        const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: args.cursor });
        for (const p of page.page) {
          if (!p.scoreParts) continue;
          const next = scoreFromPercentile(percentileOf(p.scoreParts.raw, calib.hist));
          calib.after[next]++;
          const patch: Partial<Doc<"products">> = {};
          if (p.scoreParts.v2 !== next) patch.scoreParts = { ...p.scoreParts, v2: next };
          if (model === "v2" && p.aiScore !== next) patch.aiScore = next;
          // Switched back to v1: give imported products their importer's score again.
          if (model === "v1" && p.source !== "ads" && p.aiScore === p.scoreParts.v2 && p.aiScore !== p.scoreParts.source) {
            patch.aiScore = p.scoreParts.source;
          }
          if (Object.keys(patch).length) await ctx.db.patch("products", p._id, patch);
          if (calib.top.length < 20 || next > calib.top[calib.top.length - 1].next) {
            calib.top = [...calib.top, { id: p._id, title: p.title.slice(0, 80), old: score100(p.aiScore), next }]
              .sort((a, b) => b.next - a.next)
              .slice(0, 20);
          }
        }
        done = page.isDone;
        cursor = page.continueCursor;
        if (done) await writeCalibrationReport(ctx, args.day, model, calib);
      } else if (stage === "winners") {
        const round = await readWinnersRound(ctx);
        const due = status.data.forceWinners || !round || daysBetween(round.day, args.day) >= WINNERS_ROUND_DAYS;
        if (due) {
          const w = await rebuildWinners(ctx, args.day);
          counts.winners = w.winners;
          counts.winnersGated = w.gated;
        } else {
          counts.winners = await pruneWinners(ctx);
        }
      } else if (stage === "fusion") {
        // Event-driven enrichment (convex/fusion.ts): new winners, niche entrant
        // spikes and marketplace products without ads. Runs in the background;
        // Apify results come back later through its webhook.
        await ctx.scheduler.runAfter(0, internal.fusion.runTriggers, { day: args.day });
      } else if (stage === "snapshotProducts") {
        const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: args.cursor });
        for (const p of page.page) {
          await upsertSnapshot(ctx, args.day, "product", p._id, {
            score: p.aiScore,
            adsRunning: p.linkedAds || p.adsCount || 0,
            views: p.linkedViews ?? 0,
            likes: p.likes ?? 0,
            comments: p.linkedComments ?? 0,
            spend: p.linkedSpend ?? 0,
            gmv: p.linkedGmv ?? 0,
            trend: p.trend,
            saturation: p.saturation,
          });
        }
        counts.snapshots += page.page.length;
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "snapshotAds") {
        const page = await ctx.db.query("ads").paginate({ numItems: 200, cursor: args.cursor });
        const medians = await engagementMedians(ctx);
        for (const ad of page.page) {
          const n = adNumbers(ad);
          // Scaling: 14+ days and views up 10%+ on a week ago, or engagement at/above the niche median.
          const weekAgo = await ctx.db
            .query("dailySnapshots")
            .withIndex("by_entity_day", (q) => q.eq("kind", "ad").eq("entityId", ad._id).lte("day", dayMinus(args.day, 7)))
            .order("desc")
            .first();
          const scaling = isScaling({
            daysRunning: ad.daysRunning,
            viewsNow: n.views,
            viewsWeekAgo: weekAgo?.views,
            engagement: engagementRate({ likes: n.likes, comments: n.comments, views: n.views }),
            nicheMedianEngagement: medians[ad.niche],
          });
          if ((ad.isScaling ?? false) !== scaling) await ctx.db.patch("ads", ad._id, { isScaling: scaling });
          await upsertSnapshot(ctx, args.day, "ad", ad._id, { score: ad.aiScore, adsRunning: 1, ...n });
        }
        counts.snapshots += page.page.length;
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "prune") {
        const old = await ctx.db
          .query("dailySnapshots")
          .withIndex("by_day", (q) => q.lt("day", dayMinus(args.day, KEEP_DAYS)))
          .take(1000);
        for (const row of old) await ctx.db.delete("dailySnapshots", row._id);
        counts.pruned += old.length;
        done = old.length < 1000;
      }
    } catch (e) {
      // Skip the failed step and carry on with the rest of the run.
      await skipStage(ctx, { ...status.data, counts, calib }, stage, `failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    if (done) {
      await advance(ctx, status.data, counts, calib, stage);
      return;
    }
    await writeStatus(ctx, { ...status.data, counts, calib, updatedAt: new Date().toISOString() });
    await ctx.scheduler.runAfter(0, internal.productPipeline.step, { stage, cursor, day: args.day, runId: args.runId });
  },
});

async function detach(ctx: MutationCtx, productId: Id<"products">, adId: Id<"ads">) {
  const p = await ctx.db.get("products", productId);
  if (!p?.adIds) return;
  const adIds = p.adIds.filter((id) => id !== adId);
  if (adIds.length !== p.adIds.length) await ctx.db.patch("products", p._id, { adIds, linkedAds: adIds.length });
}

// Attaches one ad to its product. Match order: landing-page URL, normalised
// product title, then the same image (the product imported from another
// source under a different URL and title); otherwise a new product is created.
export async function linkAd(ctx: MutationCtx, ad: Doc<"ads">): Promise<"created" | "linked" | "unchanged" | "skipped"> {
  if (!adSellsProduct(ad)) {
    if (ad.productId) {
      await detach(ctx, ad.productId, ad._id);
      await ctx.db.patch("ads", ad._id, { productId: undefined });
    }
    return "skipped";
  }
  const title = productTitleForAd(ad);
  const uk = urlKey(ad.landingPageUrl);
  const tk = titleKey(title);

  let product: Doc<"products"> | null = null;
  if (uk) product = await ctx.db.query("products").withIndex("by_url_key", (q) => q.eq("urlKey", uk)).first();
  if (!product && tk) product = await ctx.db.query("products").withIndex("by_title_key", (q) => q.eq("titleKey", tk)).first();
  if (!product && isUsableHash(ad.imageHash)) product = (await sameImageProducts(ctx, ad.imageHash))[0] ?? null;
  if (!product) product = (await sameStoreProducts(ctx, storeHost(ad.landingPageUrl), title))[0] ?? null;
  // No match, but already attached (e.g. moved here when duplicates were merged): stay.
  if (!product && ad.productId) product = await ctx.db.get("products", ad.productId);

  let outcome: "created" | "linked" | "unchanged" = "linked";
  if (!product) {
    const flags = productFlags(`${title} ${ad.bodyText.slice(0, 300)}`);
    const id = await ctx.db.insert("products", {
      title,
      description: `Found in ${ad.platform} ads by ${ad.advertiserName}. ${ad.bodyText}`.trim().slice(0, 500),
      imageUrl: ad.creativeUrl,
      category: ad.niche,
      tags: [ad.niche, ad.platform, "from ads"],
      aiScore: ad.aiScore,
      saturation: "Unknown",
      trend: "Unknown",
      supplierUrl: ad.landingPageUrl,
      storeUrl: ad.landingPageUrl,
      adExamples: [],
      isWinnerOfDay: false,
      publishedAt: new Date().toISOString(),
      source: "ads",
      urlKey: uk ?? undefined,
      titleKey: tk ?? undefined,
      // The image is the ad's creative, so its hash is already known.
      ...(ad.imageHash !== undefined ? productHashFields(ad.imageHash, ad.creativeUrl) : {}),
      adIds: [ad._id],
      linkedAds: 1,
      ...flags,
    });
    product = (await ctx.db.get("products", id))!;
    outcome = "created";
  } else if (ad.productId === product._id && product.adIds?.includes(ad._id)) {
    return "unchanged";
  } else if (!product.adIds?.includes(ad._id)) {
    const adIds = [...(product.adIds ?? []), ad._id].slice(-MAX_ADS_PER_PRODUCT);
    await ctx.db.patch("products", product._id, { adIds, linkedAds: adIds.length });
  }

  if (ad.productId && ad.productId !== product._id) await detach(ctx, ad.productId, ad._id);
  if (ad.productId !== product._id) await ctx.db.patch("ads", ad._id, { productId: product._id });
  return outcome;
}

// ── Merging duplicates ──────────────────────────────────────────────────────
// Products imported twice from different sources (e.g. an Amazon listing and
// a product made from ads) that share the same image are folded into one.
// Started from Admin; runs in steps over the image-hash index and records the
// result in siteStats["productDedup"].

type DedupStatus = { state: "running" | "done" | "stalled"; merged: number; startedAt: string; finishedAt?: string };

async function writeDedup(ctx: MutationCtx, data: DedupStatus) {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productDedup")).unique();
  const updatedAt = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt });
  else await ctx.db.insert("siteStats", { key: "productDedup", data, updatedAt });
}

export const mergeDuplicatesNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const startedAt = new Date().toISOString();
    await writeDedup(ctx, { state: "running", merged: 0, startedAt });
    await ctx.scheduler.runAfter(0, internal.productPipeline.mergeDuplicatesStep, { cursor: null, merged: 0, startedAt });
  },
});

// ── Score model v2: review, then switch ─────────────────────────────────────

export type CalibrationReport = {
  day: string;
  model: "v1" | "v2";
  total: number;
  before: { share85: number; share70: number; median: number; buckets: number[] };
  after: { share85: number; share70: number; median: number; buckets: number[] };
  top: { id: string; title: string; old: number; next: number }[];
};

export const scoreCalibration = query({
  args: {},
  handler: async (ctx): Promise<{ model: "v1" | "v2"; report: CalibrationReport | null }> => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "scoreCalibration")).unique();
    const model = (await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "scoreModel")).unique())?.data as
      | { model?: string }
      | undefined;
    return { model: model?.model === "v2" ? "v2" : "v1", report: (doc?.data as CalibrationReport | undefined) ?? null };
  },
});

// Switches the live score model and re-runs the pipeline so it applies now.
export const setScoreModel = mutation({
  args: { model: v.union(v.literal("v1"), v.literal("v2")) },
  handler: async (ctx, args): Promise<{ started: boolean }> => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "scoreModel")).unique();
    const data = { model: args.model, since: new Date().toISOString() };
    if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt: data.since });
    else await ctx.db.insert("siteStats", { key: "scoreModel", data, updatedAt: data.since });
    return { started: await begin(ctx) };
  },
});

export const dedupStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productDedup")).unique();
    return (doc?.data as DedupStatus | undefined) ?? null;
  },
});

export const mergeDuplicatesStep = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), merged: v.number(), startedAt: v.string() },
  handler: async (ctx, args) => {
    const page = await mergePage(ctx, args.cursor);
    const total = args.merged + page.merged;
    if (!page.isDone) {
      await writeDedup(ctx, { state: "running", merged: total, startedAt: args.startedAt });
      await ctx.scheduler.runAfter(0, internal.productPipeline.mergeDuplicatesStep, { cursor: page.cursor, merged: total, startedAt: args.startedAt });
    } else {
      await writeDedup(ctx, { state: "done", merged: total, startedAt: args.startedAt, finishedAt: new Date().toISOString() });
    }
  },
});

// One page of the duplicate scan: each product's matches (same image, or same
// store + same title) are looked up across the whole table; a group met again
// later is down to one row by then.
async function mergePage(ctx: MutationCtx, cursor: string | null): Promise<{ merged: number; isDone: boolean; cursor: string }> {
  const page = await ctx.db.query("products").paginate({ numItems: 10, cursor }); // each looks up to ~65 candidates and may move ads
  let merged = 0;
  for (const { _id } of page.page) {
    const p = await ctx.db.get("products", _id);
    if (!p) continue; // already merged away
    const found = new Map<string, Doc<"products">>([[p._id, p]]);
    if (isUsableHash(p.imageHash)) for (const m of await sameImageProducts(ctx, p.imageHash)) found.set(m._id, m);
    for (const m of await sameStoreProducts(ctx, p.storeHost ?? null, p.title)) found.set(m._id, m);
    if (found.size > 1) merged += await mergeGroup(ctx, [...found.values()]);
  }
  if (merged) await markStatsDirty(ctx);
  return { merged, isDone: page.isDone, cursor: page.continueCursor };
}

// Products whose image is the same as `hash` (up to a few bits apart, see
// lib/imageHash.ts), found through the four indexed parts of the hash.
async function sameImageProducts(ctx: MutationCtx, hash: string): Promise<Doc<"products">[]> {
  const [b0, b1, b2, b3] = hashBands(hash);
  const products = ctx.db.query("products");
  const candidates = await Promise.all([
    products.withIndex("by_hash_band_0", (q) => q.eq("hashBand0", b0)).take(10),
    products.withIndex("by_hash_band_1", (q) => q.eq("hashBand1", b1)).take(10),
    products.withIndex("by_hash_band_2", (q) => q.eq("hashBand2", b2)).take(10),
    products.withIndex("by_hash_band_3", (q) => q.eq("hashBand3", b3)).take(10),
  ]);
  const found = new Map<string, Doc<"products">>();
  for (const p of candidates.flat()) if (isSameImage(p.imageHash, hash)) found.set(p._id, p);
  return [...found.values()].sort((a, b) => a._creationTime - b._creationTime);
}

// Products from the same shop with (nearly) the same title: one listing
// imported twice under slightly different names.
async function sameStoreProducts(ctx: MutationCtx, host: string | null, title: string): Promise<Doc<"products">[]> {
  if (!host) return [];
  const sameShop = await ctx.db.query("products").withIndex("by_store_host", (q) => q.eq("storeHost", host)).take(25);
  return sameShop
    .filter((c) => [c.title, ...(c.aliases ?? [])].some((t) => titleSimilarity(t, title) >= SAME_TITLE_MIN))
    .sort((a, b) => a._creationTime - b._creationTime);
}

// Keeps one product of a same-image group and folds the others into it:
// their ads, saved-list entries and any price or cost the keeper lacks.
// Returns how many products were removed.
async function mergeGroup(ctx: MutationCtx, group: Doc<"products">[]): Promise<number> {
  // Keep an imported or curated product over one made from ads (it has the
  // real title, price and description), then the one with most ads, then the oldest.
  const sorted = [...group].sort(
    (a, b) =>
      Number(a.source === "ads") - Number(b.source === "ads") ||
      (b.linkedAds ?? 0) - (a.linkedAds ?? 0) ||
      a._creationTime - b._creationTime,
  );
  const [keep, ...rest] = sorted;
  const adIds = new Set(keep.adIds ?? []);
  // The other names stay findable as aliases.
  const aliases = new Set(keep.aliases ?? []);
  for (const dup of rest) for (const t of [dup.title, ...(dup.aliases ?? [])]) if (t && t !== keep.title) aliases.add(t);
  const fill: Partial<Doc<"products">> = {};
  for (const dup of rest) {
    for (const ad of await ctx.db.query("ads").withIndex("by_product", (q) => q.eq("productId", dup._id)).take(MAX_ADS_PER_PRODUCT)) {
      await ctx.db.patch("ads", ad._id, { productId: keep._id });
      adIds.add(ad._id);
    }
    if (keep.price === undefined && fill.price === undefined && dup.price !== undefined) {
      fill.price = dup.price;
      fill.priceSource = dup.priceSource;
      fill.originalPrice = dup.originalPrice;
    }
    if (keep.cost === undefined && fill.cost === undefined && dup.cost !== undefined) fill.cost = dup.cost;
    for (const s of await ctx.db.query("savedProducts").withIndex("by_product", (q) => q.eq("productId", dup._id)).collect()) {
      const already = await ctx.db
        .query("savedProducts")
        .withIndex("by_user_and_product", (q) => q.eq("userId", s.userId).eq("productId", keep._id))
        .first();
      if (already) await ctx.db.delete("savedProducts", s._id);
      else await ctx.db.patch("savedProducts", s._id, { productId: keep._id });
    }
    // Winning Products is rebuilt daily; drop the removed product's row now.
    for (const w of await ctx.db.query("winningProducts").withIndex("by_product", (q) => q.eq("productId", dup._id)).collect()) {
      await ctx.db.delete("winningProducts", w._id);
    }
    await ctx.db.delete("products", dup._id);
  }
  const ids = [...adIds].slice(-MAX_ADS_PER_PRODUCT);
  await ctx.db.patch("products", keep._id, { ...fill, adIds: ids, linkedAds: ids.length, aliases: [...aliases].slice(0, 10) });
  return rest.length;
}

// Adds up a product's ads. Products that exist only because of ads ("ads"
// source) also take their score, likes, image and trend from them.
export async function aggregate(ctx: MutationCtx, p: Doc<"products">, day: string, model: "v1" | "v2" = "v1", factors?: Calibrations) {
  const ads = (await Promise.all((p.adIds ?? []).map((id) => ctx.db.get("ads", id)))).filter(
    (a): a is Doc<"ads"> => !!a && a.productId === p._id,
  );
  if (ads.length === 0 && p.source === "ads") {
    const saved = await ctx.db.query("savedProducts").withIndex("by_product", (q) => q.eq("productId", p._id)).first();
    if (!saved) {
      await ctx.db.delete("products", p._id);
      await markStatsDirty(ctx);
      return;
    }
  }
  const sum = { views: 0, likes: 0, comments: 0, spend: 0, gmv: 0 };
  let best = 0;
  for (const ad of ads) {
    const n = adNumbers(ad);
    sum.views += n.views;
    sum.likes += n.likes;
    sum.comments += n.comments;
    sum.spend += n.spend;
    sum.gmv += n.gmv;
    best = Math.max(best, ad.aiScore);
  }
  const patch: Partial<Doc<"products">> = {
    adIds: ads.map((a) => a._id),
    linkedAds: ads.length,
    linkedViews: sum.views,
    linkedComments: sum.comments,
    linkedSpend: sum.spend,
    linkedGmv: sum.gmv,
  };
  // A price an import wrote into the ad text ("Product Price: $12.61").
  if (p.price === undefined) {
    for (const ad of ads) {
      const found = priceFromAdText(ad.bodyText ?? "");
      const usd = found ? toUsd(found) : undefined;
      if (found && usd !== undefined) {
        patch.price = usd;
        patch.priceSource = "ad_data";
        patch.originalPrice = priceLabel(found);
        break;
      }
    }
  }
  // "Ads running" (sort and filter) counts linked ads too.
  if (ads.length > (p.adsCount ?? 0) || p.source === "ads") patch.adsCount = ads.length;
  // Saturation from our own data: how many different advertisers run this
  // product. Products made from ads always use it; others only fill an "Unknown".
  const advertisers = new Set(ads.map((a) => a.advertiserName.trim().toLowerCase()).filter(Boolean));
  if (advertisers.size && (p.source === "ads" || p.saturation === "Unknown")) patch.saturation = saturationFromCompetition(advertisers.size);
  // Ads running now: not marked stopped and seen in the last 14 days.
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  // Competition by country this week: distinct advertisers among ads seen in the last 7 days.
  const byCountry = new Map<string, Set<string>>();
  for (const a of ads) {
    if (Date.parse(a.lastSeenAt ?? a.firstSeenAt) < dayMs - 7 * 86_400_000) continue;
    for (const c of new Set([a.country, ...(a.countries ?? [])])) {
      if (!c || c === "INTL") continue;
      byCountry.set(c, (byCountry.get(c) ?? new Set()).add(a.advertiserName.trim().toLowerCase()));
    }
  }
  patch.saturationByCountry = [...byCountry]
    .map(([country, set]) => ({ country, advertisers: set.size, level: saturationFromCompetition(set.size) }))
    .sort((a, b) => b.advertisers - a.advertisers)
    .slice(0, 12);
  const running = ads.filter((a) => a.isActive !== false && (!a.lastSeenAt || dayMs - Date.parse(a.lastSeenAt) <= 14 * 86_400_000));
  patch.activeAds = Math.max(running.length, p.source === "ads" ? 0 : (p.adsCount ?? 0));
  // Views change over 14 days (winner gate), from the history rows.
  const twoWeeksAgo = await ctx.db
    .query("dailySnapshots")
    .withIndex("by_entity_day", (q) => q.eq("kind", "product").eq("entityId", p._id).lte("day", dayMinus(day, 14)))
    .order("desc")
    .first();
  patch.momentum14 = twoWeeksAgo && twoWeeksAgo.views > 0 ? Math.round(((sum.views - twoWeeksAgo.views) / twoWeeksAgo.views) * 1000) / 10 : undefined;
  // Which independent source families back this product, and do they agree (lib/fusion.ts).
  patch.fusion = fusion({
    productSource: p.source ?? "",
    unitsPerMonth: p.unitsPerMonth,
    trend: p.trend,
    growthPercent: p.growthPercent,
    momentum14: patch.momentum14,
    activeAds: patch.activeAds,
    marginKnown: (patch.price ?? p.price) !== undefined && p.cost !== undefined,
    saturation: patch.saturation ?? p.saturation,
    ads: ads.map((a) => ({ sources: a.sources ?? [a.source], isActive: a.isActive, isScaling: a.isScaling })),
  });
  if (p.source === "ads" && ads.length) {
    // Old model (v1): more ads for the same product = the seller is scaling it.
    // Under v2 the calibration stage writes the score instead.
    if (model === "v1") patch.aiScore = Math.min(100, best + 3 * (ads.length - 1));
    patch.likes = sum.likes;
    if (!p.imageUrl) patch.imageUrl = ads.find((a) => a.creativeUrl)?.creativeUrl ?? "";
    // The numbers as of a week ago: the latest row on or before that day (rows
    // are only written on days something changed, see upsertSnapshot).
    const weekAgo = await ctx.db
      .query("dailySnapshots")
      .withIndex("by_entity_day", (q) => q.eq("kind", "product").eq("entityId", p._id).lte("day", dayMinus(day, 7)))
      .order("desc")
      .first();
    if (weekAgo && weekAgo.views > 0) {
      const growth = (sum.views - weekAgo.views) / weekAgo.views;
      patch.trend = growth >= 0.2 ? "Rising" : growth >= 0.02 ? "Stable" : "Declining";
      patch.growthPercent = Math.round(growth * 1000) / 10;
    }
  }
  const est = estimatesFor({ ...p, ...patch }, sum, factors);
  const days = ads.map((a) => a.daysRunning).filter((d) => d > 0).sort((a, b) => a - b);
  const parts = scorePartsFor({ ...p, ...patch, ...est }, {
    medianDaysRunning: days.length ? days[Math.floor(days.length / 2)] : undefined,
    sourceScore: p.source === "ads" ? best : importerScore(p),
  });
  await ctx.db.patch("products", p._id, { ...patch, ...est, scoreParts: parts });
}

// The score the importer gave a product. Once v2 scores are live, aiScore is
// our own calibrated score, so the importer's is the one kept in scoreParts.
function importerScore(p: Doc<"products">): number {
  return p.scoreParts?.v2 !== undefined && p.aiScore === p.scoreParts.v2 ? p.scoreParts.source : p.aiScore;
}

// The five score parts and raw score (lib/productScore.ts); keeps the last v2
// score until the calibration stage updates it.
function scorePartsFor(
  p: Doc<"products">,
  extra: { medianDaysRunning?: number; sourceScore: number },
): NonNullable<Doc<"products">["scoreParts"]> {
  const parts = scoreParts({
    activeAds: p.activeAds ?? p.adsCount ?? 0,
    medianDaysRunning: extra.medianDaysRunning,
    sourceScore: extra.sourceScore,
    revenuePerMonth: pointEstimate(p.estRevenue),
    growthPercent: p.growthPercent,
    trend: p.trend,
    saturation: p.saturation,
    marginPercent: p.marginPercent,
  });
  return { ...parts, raw: rawScore(parts), source: extra.sourceScore, ...(p.scoreParts?.v2 !== undefined ? { v2: p.scoreParts.v2 } : {}) };
}

// Modelled impressions / ad spend / monthly revenue (lib/estimates.ts) from
// what the product has: its ads' numbers, marketplace sales, price, likes.
function estimatesFor(
  p: Doc<"products">,
  ads?: { views: number; likes: number; comments: number; spend: number; gmv: number },
  factors?: Calibrations,
): Partial<Doc<"products">> {
  const units = p.unitsPerMonth ?? unitsPerMonthFromText(p.description ?? "");
  const e = estimateProduct({
    price: p.price,
    views: ads?.views ?? p.linkedViews,
    likes: ads?.likes ?? p.likes,
    comments: ads?.comments ?? p.linkedComments,
    spend: ads?.spend ?? p.linkedSpend,
    gmv: ads?.gmv ?? p.linkedGmv,
    unitsPerMonth: units,
  });
  // Scaled by how far this method was off on the known-truth set (revenueTruth.ts).
  const f = factorFor(factors, e.revenueBasis);
  if (e.revenue && f !== 1) e.revenue = { low: Math.round(e.revenue.low * f), high: Math.round(e.revenue.high * f) };
  return {
    ...(units !== undefined ? { unitsPerMonth: units } : {}),
    estImpressions: e.impressions,
    estAdSpend: e.adSpend,
    estRevenue: e.revenue,
    estBasis: { impressions: e.impressionsBasis, adSpend: e.adSpendBasis, revenue: e.revenueBasis },
  };
}

async function applyEstimates(ctx: MutationCtx, p: Doc<"products">, factors?: Calibrations) {
  const est = estimatesFor(p, undefined, factors);
  const patch: Partial<Doc<"products">> = { ...est, scoreParts: scorePartsFor({ ...p, ...est }, { sourceScore: importerScore(p) }) };
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if ((Object.keys(patch) as (keyof typeof patch)[]).every((k) => same(patch[k], p[k]))) return;
  await ctx.db.patch("products", p._id, patch);
}

async function writeCalibrationReport(ctx: MutationCtx, day: string, model: "v1" | "v2", c: Calibration) {
  const data = {
    day,
    model,
    total: c.after.reduce((a, b) => a + b, 0),
    before: { share85: shareAtLeast(c.before, 85), share70: shareAtLeast(c.before, 70), median: medianOf(c.before), buckets: buckets(c.before) },
    after: { share85: shareAtLeast(c.after, 85), share70: shareAtLeast(c.after, 70), median: medianOf(c.after), buckets: buckets(c.after) },
    top: c.top,
  };
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "scoreCalibration")).unique();
  const updatedAt = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt });
  else await ctx.db.insert("siteStats", { key: "scoreCalibration", data, updatedAt });
}

// 0-9, 10-19 ... 90-100 counts for the report.
function buckets(h: number[]): number[] {
  const out = zeros(10);
  h.forEach((n, s) => (out[Math.min(9, Math.floor(s / 10))] += n));
  return out;
}

// ── Winning Products ────────────────────────────────────────────────────────
// Every WINNERS_ROUND_DAYS a new mix is drawn from the products we have.
// Per niche, products with score 65+ (no big brands, print-on-demand or
// services) that pass the winner gates (lib/winnerGates.ts) come first: the
// best 25 always stay, the other places rotate, products not shown last
// round first (lib/winnerMix.ts). Free places go to products that fail a gate
// only because we don't have the data yet; never to ones that fail on real
// numbers. Niches are dealt out round-robin so the feed alternates.

type WinnersRound = { day: string; nextDay: string };

export async function readWinnersRound(ctx: { db: QueryCtx["db"] }): Promise<WinnersRound | null> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "winnersRound")).unique();
  return (doc?.data as WinnersRound | undefined) ?? null;
}

async function writeWinnersRound(ctx: MutationCtx, day: string) {
  const data: WinnersRound = { day, nextDay: addDays(day, WINNERS_ROUND_DAYS) };
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "winnersRound")).unique();
  const updatedAt = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt });
  else await ctx.db.insert("siteStats", { key: "winnersRound", data, updatedAt });
}

const listable = (p: Doc<"products">) => p.aiScore >= WINNER_MIN_SCORE && !p.isBigBrand && !p.isPersonalised && !p.isService && !!p.imageUrl;
const gateInput = (p: Doc<"products">) => ({
  revenuePerMonth: pointEstimate(p.estRevenue),
  activeAds: p.activeAds ?? p.adsCount,
  momentum14: p.momentum14,
  saturation: p.saturation,
});

export async function rebuildWinners(ctx: MutationCtx, day: string): Promise<{ winners: number; gated: number }> {
  const previous = await ctx.db.query("winningProducts").collect();
  const shownBefore = new Set(previous.map((r) => r.productId as string));
  const perNiche: { niche: string; products: Doc<"products">[] }[] = [];
  let gated = 0;
  for (const niche of NICHES) {
    const proven: Doc<"products">[] = [];
    const unproven: Doc<"products">[] = []; // fail a gate only for missing data
    const candidates = ctx.db
      .query("products")
      .withIndex("by_category_score", (q) => q.eq("category", niche).gte("aiScore", WINNER_MIN_SCORE))
      .order("desc");
    let scanned = 0;
    for await (const p of candidates) {
      if (++scanned > MAX_WINNER_CANDIDATES) break;
      if (!listable(p)) continue;
      // A high score isn't enough: real sales, live ads, momentum, room left.
      const g = gateInput(p);
      if (passesWinnerGates({ ...g, activeAds: g.activeAds ?? 0 }).ok) proven.push(p);
      else if (passesKnownGates(g)) unproven.push(p);
      else gated++;
    }
    const picks = pickNicheMix(proven, shownBefore, `${day}:${niche}`, WINNERS_PER_NICHE);
    const fill = pickNicheMix(unproven, shownBefore, `${day}:${niche}:fill`, WINNERS_PER_NICHE - picks.length);
    gated += unproven.length - fill.length;
    const products = [...picks, ...fill];
    if (products.length) perNiche.push({ niche, products });
  }
  perNiche.sort((a, b) => b.products[0].aiScore - a.products[0].aiScore);
  const feed = roundRobin(perNiche.map((n) => n.products.map((p, i) => ({ p, niche: n.niche, rank: i + 1 }))));

  const enteredBefore = new Map(previous.map((r) => [r.productId as string, r.enteredDay]));
  const keep = new Set(feed.map((f) => f.p._id as string));
  for (const r of previous) {
    await ctx.db.delete("winningProducts", r._id);
    if (!keep.has(r.productId)) await clearWinner(ctx, r.productId);
  }
  for (const [position, f] of feed.entries()) {
    await ctx.db.insert("winningProducts", {
      productId: f.p._id,
      niche: f.niche,
      nicheRank: f.rank,
      position,
      score: f.p.aiScore,
      enteredDay: enteredBefore.get(f.p._id) ?? day,
    });
    // Verified: a winner whose signals agree across source families (lib/fusion.ts).
    const verified = isVerifiedWinner(true, f.p.fusion) || undefined;
    if (f.p.winnerRank !== f.rank || f.p.verifiedWinner !== verified || !f.p.winnerSince) {
      await ctx.db.patch("products", f.p._id, { winnerRank: f.rank, verifiedWinner: verified, winnerSince: f.p.winnerSince ?? day });
    }
  }
  await writeWinnersRound(ctx, day);
  return { winners: feed.length, gated };
}

async function clearWinner(ctx: MutationCtx, productId: Id<"products">) {
  const p = await ctx.db.get("products", productId);
  if (p && (p.winnerRank !== undefined || p.verifiedWinner)) await ctx.db.patch("products", p._id, { winnerRank: undefined, verifiedWinner: undefined });
}

// Between rounds: keep the mix, only take out products that were deleted,
// moved niche or now fail on real numbers. Nothing new is added.
export async function pruneWinners(ctx: MutationCtx): Promise<number> {
  const rows = await ctx.db.query("winningProducts").collect();
  let kept = 0;
  for (const r of rows) {
    const p = await ctx.db.get("products", r.productId);
    if (p && listable(p) && p.category === r.niche && passesKnownGates(gateInput(p))) {
      kept++;
      continue;
    }
    await ctx.db.delete("winningProducts", r._id);
    await clearWinner(ctx, r.productId);
  }
  return kept;
}

type SnapshotValues = Omit<Doc<"dailySnapshots">, "_id" | "_creationTime" | "day" | "kind" | "entityId">;

// Writes today's row only when the numbers changed since the latest one (or it's
// 30+ days old): frozen ads and products don't add a row a day. The history
// queries fill the skipped days back in (lib/snapshots.ts fillDays).
async function upsertSnapshot(ctx: MutationCtx, day: string, kind: "product" | "ad", entityId: string, values: SnapshotValues) {
  const latest = await ctx.db
    .query("dailySnapshots")
    .withIndex("by_entity_day", (q) => q.eq("kind", kind).eq("entityId", entityId).lte("day", day))
    .order("desc")
    .first();
  if (latest?.day === day) await ctx.db.patch("dailySnapshots", latest._id, values);
  else if (shouldWriteSnapshot(latest, day, values)) await ctx.db.insert("dailySnapshots", { day, kind, entityId, ...values });
}
