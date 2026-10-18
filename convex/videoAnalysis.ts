import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import {
  ANALYZE_RUNS, ANALYZER_ACTOR, DEFAULT_DAILY_ANALYSES, MAX_VIDEO_MINUTES, RUNNING_STALE_MS, analyzerFailure, readAnalysis,
} from "./lib/videoAnalysis";

// ── Video ad analysis ───────────────────────────────────────────────────────
// Ad page → "Analyse video": Apify's tubetext/video-ad-analyzer watches the
// video and gives its hook, angle, beats and shot list (lib/videoAnalysis.ts).
// `start` claims a run and schedules `run`; the page follows `forAd`. Kept on
// the ad for everyone, so each ad is analysed once. Per-user daily limit
// ANALYZE_RUNS, all users VIDEO_ANALYSES_PER_DAY; needs APIFY_TOKEN.

const DAY_MS = 24 * 60 * 60 * 1000;

const videoUrls = (ad: Doc<"ads">) =>
  [ad.hostedVideoUrl, ad.videoUrl].filter((u, i, all): u is string => !!u && /^https?:\/\//.test(u) && all.indexOf(u) === i);

export const forAd = query({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity())) return null;
    const row = await ctx.db.query("videoAnalyses").withIndex("by_ad", (q) => q.eq("adId", args.adId)).unique();
    if (!row) return null;
    const stale = row.status === "running" && Date.now() - row.startedAt > RUNNING_STALE_MS;
    return {
      status: stale ? "failed" : row.status,
      result: row.status === "done" ? (row.result as ReturnType<typeof readAnalysis>) : null,
      error: stale ? "The analysis took too long. Try again." : (row.error ?? null),
    };
  },
});

export const start = mutation({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<{ started: boolean; left: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const ad = await ctx.db.get("ads", args.adId);
    if (!ad) throw new ConvexError({ code: "NOT_FOUND", message: "This ad isn't there anymore." });
    if (!videoUrls(ad).length) throw new ConvexError({ code: "NO_VIDEO", message: "This ad has no video file we can read." });

    const limit = byTier(user, ANALYZE_RUNS);
    const since = Date.now() - DAY_MS;
    const used = (await ctx.db.query("analyzeRuns").withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", since)).take(limit)).length;
    const row = await ctx.db.query("videoAnalyses").withIndex("by_ad", (q) => q.eq("adId", ad._id)).unique();
    if (row?.status === "done") return { started: false, left: Math.max(0, limit - used) };
    if (row?.status === "running" && Date.now() - row.startedAt < RUNNING_STALE_MS) return { started: false, left: Math.max(0, limit - used) };

    if (used >= limit) {
      throw new ConvexError({
        code: "LIMIT",
        message:
          limit <= ANALYZE_RUNS.trial
            ? `You've analysed ${limit} video${limit === 1 ? "" : "s"} today. Upgrade to Pro for ${ANALYZE_RUNS.paid} a day.`
            : `You've analysed ${limit} videos today. Try again tomorrow.`,
      });
    }
    const daily = Math.max(0, Number(process.env.VIDEO_ANALYSES_PER_DAY ?? DEFAULT_DAILY_ANALYSES) || 0);
    const today = (await ctx.db.query("analyzeRuns").withIndex("by_at", (q) => q.gt("at", since)).take(daily)).length;
    if (user.role !== "admin" && today >= daily) {
      throw new ConvexError({ code: "LIMIT", message: "Video analysis is busy today. Try again tomorrow." });
    }

    const now = Date.now();
    await ctx.db.insert("analyzeRuns", { userId: user._id, at: now });
    if (row) await ctx.db.patch("videoAnalyses", row._id, { status: "running", error: undefined, startedAt: now, finishedAt: undefined });
    else await ctx.db.insert("videoAnalyses", { adId: ad._id, status: "running", startedAt: now });
    await ctx.scheduler.runAfter(0, internal.videoAnalysis.run, { adId: ad._id });
    return { started: true, left: Math.max(0, limit - used - 1) };
  },
});

export const videoFor = internalQuery({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.adId);
    return ad ? videoUrls(ad) : [];
  },
});

export const finish = internalMutation({
  args: { adId: v.id("ads"), result: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("videoAnalyses").withIndex("by_ad", (q) => q.eq("adId", args.adId)).unique();
    if (!row) return;
    await ctx.db.patch("videoAnalyses", row._id, {
      status: args.result ? "done" : "failed",
      result: args.result,
      error: args.result ? undefined : (args.error ?? "We couldn't analyse this video."),
      finishedAt: Date.now(),
    });
  },
});

// One Apify run per video link, our own copy first (source links expire).
export const run = internalAction({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) {
      await ctx.runMutation(internal.videoAnalysis.finish, { adId: args.adId, error: "Video analysis isn't switched on yet (APIFY_TOKEN)." });
      return;
    }
    const urls = await ctx.runQuery(internal.videoAnalysis.videoFor, { adId: args.adId });
    let error = "This ad has no video file we can read.";
    for (const url of urls) {
      try {
        const q = new URLSearchParams({ token, timeout: "240" });
        const res = await fetch(`https://api.apify.com/v2/acts/${ANALYZER_ACTOR}/run-sync-get-dataset-items?${q}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adUrls: [url],
            advertisers: [],
            metaBrands: [],
            outputLanguage: "English",
            includeTranscript: false,
            maxVideoMinutes: MAX_VIDEO_MINUTES,
            maxConcurrency: 1,
          }),
          signal: AbortSignal.timeout(260_000),
        });
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          console.warn("Video analysis: Apify", res.status, text);
          error = /hard limit|usage limit|insufficient|credit/i.test(text)
            ? "Video analysis has used this month's credit. Try again later."
            : "We couldn't analyse this video. Try again later.";
          continue;
        }
        const items = (await res.json().catch(() => null)) as unknown[] | null;
        const result = readAnalysis(items?.[0]);
        if (result) {
          await ctx.runMutation(internal.videoAnalysis.finish, { adId: args.adId, result });
          return;
        }
        error = analyzerFailure(items?.[0]);
      } catch (e) {
        console.warn("Video analysis failed", e);
        error = "The analysis took too long. Try again.";
      }
    }
    await ctx.runMutation(internal.videoAnalysis.finish, { adId: args.adId, error });
  },
});

// For the variant script (videoAnalysisAi.ts).
export const analysisFor = internalQuery({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("videoAnalyses").withIndex("by_ad", (q) => q.eq("adId", args.adId)).unique();
    return row?.status === "done" ? (row.result as NonNullable<ReturnType<typeof readAnalysis>>) : null;
  },
});
