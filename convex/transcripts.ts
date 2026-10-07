import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { spokenHook, type TranscriptWord } from "./lib/hooks";

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

export const dailyTranscripts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; updated: number; errors: string[] }> => {
    const key = process.env.DEEPGRAM_API_KEY?.trim();
    if (!key) return { notConfigured: "DEEPGRAM_API_KEY isn't set (video transcripts)" };
    const todo = await ctx.runQuery(internal.transcripts.candidates, {});
    const out = { fetched: 0, updated: 0, errors: [] as string[] };
    for (const item of todo) {
      try {
        const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true", {
          method: "POST",
          headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.url }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = (await res.json()) as {
          results?: { channels?: { alternatives?: { transcript?: string; words?: TranscriptWord[] }[] }[] };
          err_msg?: string;
        };
        if (!res.ok) {
          // A dead video link won't come back: mark it checked so it isn't retried daily.
          await ctx.runMutation(internal.transcripts.save, { id: item.id });
          out.errors.push(`${item.id}: ${body.err_msg ?? `HTTP ${res.status}`}`.slice(0, 200));
          continue;
        }
        out.fetched++;
        const alt = body.results?.channels?.[0]?.alternatives?.[0];
        const hook = alt?.words ? spokenHook(alt.words) : null;
        await ctx.runMutation(internal.transcripts.save, { id: item.id, transcript: alt?.transcript || undefined, hook: hook ?? undefined });
        if (hook) out.updated++;
      } catch (e) {
        out.errors.push(`${item.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
    return out;
  },
});
