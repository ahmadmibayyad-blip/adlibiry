import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEEPGRAM_URL, TRANSCRIBE_RUNS, readDeepgram, type DeepgramBody } from "./lib/deepgram";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";

// Daily (crons.ts → importRuns "transcripts"): speech-to-text for the
// strongest video ads that have none, so Hooks of the week can use what's
// actually said in the first 3 seconds (lib/hooks.ts spokenHook). Uses
// Deepgram's pre-recorded API on the ad's video URL; needs Convex env
// DEEPGRAM_API_KEY. Scaling ads first, then the best-scoring ones.

const PER_RUN = 40;

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: { id: Id<"ads">; url: string }[] = [];
    const want = (a: { videoUrl?: string; transcriptCheckedAt?: string }) => !!a.videoUrl && !a.transcriptCheckedAt;
    for await (const a of ctx.db.query("ads").withIndex("by_score").order("desc")) {
      if (out.length >= PER_RUN) break;
      if (want(a) && a.isScaling) out.push({ id: a._id, url: a.videoUrl! });
    }
    if (out.length < PER_RUN) {
      const top = await ctx.db.query("ads").withIndex("by_score").order("desc").take(800);
      for (const a of top) {
        if (out.length >= PER_RUN) break;
        if (want(a) && !out.some((o) => o.id === a._id)) out.push({ id: a._id, url: a.videoUrl! });
      }
    }
    return out;
  },
});

export const save = internalMutation({
  args: { id: v.id("ads"), transcript: v.optional(v.string()), hook: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get("ads", args.id))) return;
    await ctx.db.patch("ads", args.id, {
      transcriptCheckedAt: new Date().toISOString(),
      ...(args.transcript ? { transcript: args.transcript.slice(0, 4000) } : {}),
      ...(args.hook ? { spokenHook: args.hook } : {}),
    });
  },
});

/** Deepgram's transcript of the video at url, or why it couldn't be read. */
async function listen(key: string, url: string): Promise<{ ok: true; result: { transcript?: string; hook?: string } } | { ok: false; error: string }> {
  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => null)) as DeepgramBody | null;
  if (!res.ok) return { ok: false, error: body?.err_msg ?? `HTTP ${res.status}` };
  return { ok: true, result: readDeepgram(body) };
}

export const dailyTranscripts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; updated: number; errors: string[] }> => {
    const key = process.env.DEEPGRAM_API_KEY?.trim();
    if (!key) return { notConfigured: "DEEPGRAM_API_KEY isn't set (video transcripts)" };
    const todo = await ctx.runQuery(internal.transcripts.candidates, {});
    const out = { fetched: 0, updated: 0, errors: [] as string[] };
    for (const item of todo) {
      try {
        const r = await listen(key, item.url);
        if (!r.ok) {
          // A dead video link won't come back: mark it checked so it isn't retried daily.
          await ctx.runMutation(internal.transcripts.save, { id: item.id });
          out.errors.push(`${item.id}: ${r.error}`.slice(0, 200));
          continue;
        }
        out.fetched++;
        await ctx.runMutation(internal.transcripts.save, { id: item.id, ...r.result });
        if (r.result.hook) out.updated++;
      } catch (e) {
        out.errors.push(`${item.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
    return out;
  },
});

// ── Translation (transcriptsAi.translate) ───────────────────────────────────

export const forTranslation = internalQuery({
  args: { id: v.id("ads") },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.id);
    if (!ad?.transcript) return null;
    return { transcript: ad.transcript, translations: ad.transcriptTranslations ?? {} };
  },
});

export const saveTranslation = internalMutation({
  args: { id: v.id("ads"), language: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.id);
    if (!ad) return;
    await ctx.db.patch("ads", args.id, { transcriptTranslations: { ...(ad.transcriptTranslations ?? {}), [args.language]: args.text.slice(0, 6000) } });
  },
});

// ── Transcribe video (ad page and pop-up) ───────────────────────────────────

const DAY_MS = 86_400_000;

export const beforeTranscribe = internalQuery({
  args: { token: v.string(), adId: v.id("ads") },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const ad = await ctx.db.get("ads", args.adId);
    const limit = byTier(user, TRANSCRIBE_RUNS);
    const used = (await ctx.db.query("transcribeRuns").withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS)).take(limit)).length;
    return {
      userId: user._id,
      used,
      limit,
      ad: ad && { videoUrl: ad.videoUrl, hostedVideoUrl: ad.hostedVideoUrl, transcript: ad.transcript, spokenHook: ad.spokenHook },
    };
  },
});

export const countRun = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.insert("transcribeRuns", { userId: args.userId, at: Date.now() });
  },
});

/**
 * "Transcribe video": the ad's transcript and spoken hook now, saved on the ad
 * for everyone. Counts against the user's day (TRANSCRIBE_RUNS) unless the ad
 * already has one. Tries our own copy of the video when the source link fails.
 */
export const transcribe = action({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<{ transcript: string | null; hook: string | null; left: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const pre = await ctx.runQuery(internal.transcripts.beforeTranscribe, { token: stableToken(identity), adId: args.adId });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const ad = pre.ad;
    if (!ad) throw new ConvexError({ code: "NOT_FOUND", message: "This ad isn't there anymore." });
    const left = Math.max(0, pre.limit - pre.used);
    if (ad.transcript) return { transcript: ad.transcript, hook: ad.spokenHook ?? null, left };
    const urls = [ad.videoUrl, ad.hostedVideoUrl].filter((u, i, all): u is string => !!u && /^https?:\/\//.test(u) && all.indexOf(u) === i);
    if (!urls.length) throw new ConvexError({ code: "NO_VIDEO", message: "This ad has no video file we can read." });
    if (pre.used >= pre.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message:
          pre.limit <= TRANSCRIBE_RUNS.trial
            ? `You've transcribed ${pre.limit} videos today. Upgrade to Pro for ${TRANSCRIBE_RUNS.paid} a day.`
            : `You've transcribed ${pre.limit} videos today. Try again tomorrow.`,
      });
    }
    const key = process.env.DEEPGRAM_API_KEY?.trim();
    if (!key) throw new ConvexError({ code: "NOT_SET_UP", message: "Transcripts aren't switched on yet (DEEPGRAM_API_KEY)." });
    await ctx.runMutation(internal.transcripts.countRun, { userId: pre.userId });
    let error = "";
    for (const url of urls) {
      const r = await listen(key, url).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (r.ok) {
        await ctx.runMutation(internal.transcripts.save, { id: args.adId, ...r.result });
        return { transcript: r.result.transcript ?? null, hook: r.result.hook ?? null, left: left - 1 };
      }
      error = r.error;
    }
    console.warn("Transcribe:", args.adId, error);
    throw new ConvexError({ code: "VIDEO_UNREADABLE", message: "The video couldn't be read. Its link may have expired." });
  },
});
