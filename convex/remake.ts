import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { appUrl, tierOf } from "./lib/billing";
import { FalError, describeFalError, falCancel, falModels, falResult, falStatus, falSubmit, isTransient, videoUrlOf, type FalJob } from "./lib/fal";
import { ELEVEN_FORMAT, ELEVEN_MODEL, ELEVEN_URL, describeElevenError } from "./lib/voiceover";
import {
  ATTEMPTS_PER_DAY, COMPOSE_KEEPS_VIDEO_AUDIO, MAX_LINES, MAX_SECONDS, POLL_MS, REMAKE_ACTORS, STALE_MS, composeTracks, maxVoicedSeconds, mp3Seconds, productPrompt, seedanceDuration,
  type Segment, estimateSeconds, monthStart, photoProblem, planShots, remakePack, remakeSecondsLimit, splitCharge,
} from "./lib/remake";

// ── Remake this winner ──────────────────────────────────────────────────────
// Ad page → "Write my version" script → "Make the video": `start` checks the
// photo, the script and the user's AI-video seconds (lib/remake.ts), charges
// the estimate and schedules `advance`, which voices, renders and composes the
// video step by step. The page follows `latestForAd`. Needs FAL_KEY.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMAKES_PER_DAY = 30;
const ACTIVE = new Set(["voicing", "rendering", "composing"]);
export const STALE_MESSAGE = "The video took too long. Try again; it didn't use your seconds.";

const fail = (code: string, message: string) => new ConvexError({ code, message });
const isStale = (r: Doc<"remakes">, now: number) => ACTIVE.has(r.status) && now - r.startedAt > STALE_MS;
// Rows that use seconds: everything but failed and lost ones.
const counts = (r: Doc<"remakes">, now: number) => r.status !== "failed" && !isStale(r, now);

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function balance(ctx: QueryCtx, user: Doc<"users">, now: number) {
  const limit = remakeSecondsLimit(user, process.env);
  let used = 0;
  for (const r of await ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", user._id).gte("startedAt", monthStart(now))).collect()) {
    if (counts(r, now)) used += r.monthlySeconds;
  }
  let extra = 0;
  for (const t of await ctx.db.query("remakeTopUps").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) extra += t.seconds;
  for (const r of await ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) {
    if (counts(r, now)) extra -= r.extraSeconds;
  }
  const tier = tierOf(user, now);
  return { limit, used, extra: Math.max(0, extra), canBuy: tier === "paid" || tier === "admin", pack: remakePack(process.env) };
}

export const allowance = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? await balance(ctx, user, Date.now()) : null;
  },
});

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (!(await currentUser(ctx))) throw fail("UNAUTHENTICATED", "Please sign in first.");
    return await ctx.storage.generateUploadUrl();
  },
});

type Line = { scene: string; onScreenText: string; voiceover: string };

function readLines(variant: unknown): Line[] {
  const lines = (variant as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) throw fail("BAD_REQUEST", "Write the script first.");
  const str = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 400) : "");
  return lines.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return { scene: str(o.scene), onScreenText: str(o.onScreenText), voiceover: str(o.voiceover) };
  });
}

export const start = mutation({
  args: {
    adId: v.id("ads"),
    variant: v.any(),
    actorId: v.string(),
    voiceId: v.string(),
    product: v.string(),
    productImageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<Id<"remakes">> => {
    const user = await currentUser(ctx);
    if (!user) throw fail("UNAUTHENTICATED", "Please sign in first.");
    if (!process.env.FAL_KEY) throw fail("NOT_CONFIGURED", "AI video isn't switched on yet (FAL_KEY).");
    if (!(await ctx.db.get("ads", args.adId))) throw fail("NOT_FOUND", "This ad isn't there anymore.");
    if (!REMAKE_ACTORS.some((a) => a.id === args.actorId)) throw fail("BAD_REQUEST", "Pick an actor from the list.");
    if (!/^[A-Za-z0-9]{8,40}$/.test(args.voiceId)) throw fail("BAD_REQUEST", "Pick a voice from the list.");
    const product = args.product.trim();
    if (product.length < 3 || product.length > 200) throw fail("BAD_REQUEST", "Name your product in a few words.");
    const photoError = photoProblem(await ctx.db.system.get(args.productImageId));
    if (photoError) throw fail("BAD_PHOTO", photoError);
    const lines = readLines(args.variant);
    const segments = planShots(lines);
    if (!segments.length) throw fail("BAD_REQUEST", "This script has no voice-over to say.");
    const seconds = estimateSeconds(lines);
    if (seconds > MAX_SECONDS) throw fail("TOO_LONG", `Shorten the script to about ${MAX_SECONDS} seconds.`);

    const now = Date.now();
    const b = await balance(ctx, user, now);
    if (b.limit === 0 && b.extra === 0) throw fail("LIMIT", "AI videos come with Pro.");
    const charge = splitCharge(seconds, b.limit === null ? null : b.limit - b.used, b.extra);
    if (!charge) {
      const left = Math.max(0, (b.limit ?? 0) - b.used) + b.extra;
      const buy = b.canBuy ? ` Buy ${b.pack.seconds} more seconds for €${b.pack.cents / 100}.` : "";
      throw fail("LIMIT", `You have ${left} second${left === 1 ? "" : "s"} of AI video left.${buy}`);
    }
    const latest = await ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").first();
    if (latest && ACTIVE.has(latest.status) && !isStale(latest, now)) throw fail("BUSY", "Your last video is still being made.");
    const mine = await ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", user._id).gt("startedAt", now - DAY_MS)).take(ATTEMPTS_PER_DAY);
    if (user.role !== "admin" && mine.length >= ATTEMPTS_PER_DAY) throw fail("LIMIT", `You've started ${ATTEMPTS_PER_DAY} videos today. Try again tomorrow.`);
    const daily = Math.max(0, Number(process.env.REMAKES_PER_DAY ?? DEFAULT_REMAKES_PER_DAY) || 0);
    const today = (await ctx.db.query("remakes").withIndex("by_started", (q) => q.gt("startedAt", now - DAY_MS)).take(daily)).length;
    if (user.role !== "admin" && today >= daily) throw fail("LIMIT", "AI video is busy today. Try again tomorrow.");

    const remakeId = await ctx.db.insert("remakes", {
      userId: user._id,
      adId: args.adId,
      status: "voicing",
      actorId: args.actorId,
      voiceId: args.voiceId,
      product,
      productImageId: args.productImageId,
      segments,
      seconds,
      monthlySeconds: charge.monthly,
      extraSeconds: charge.extra,
      startedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.remake.advance, { remakeId });
    return remakeId;
  },
});

export const latestForAd = query({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const r = await ctx.db
      .query("remakes")
      .withIndex("by_user_ad", (q) => q.eq("userId", user._id).eq("adId", args.adId))
      .order("desc")
      .first();
    if (!r) return null;
    const stale = isStale(r, Date.now());
    return {
      _id: r._id,
      status: stale ? "failed" : r.status,
      error: stale ? STALE_MESSAGE : (r.error ?? null),
      videoUrl: r.status === "done" && r.videoId ? await ctx.storage.getUrl(r.videoId) : null,
      seconds: r.seconds,
    };
  },
});

export const load = internalQuery({
  args: { remakeId: v.id("remakes") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("remakes", args.remakeId);
    if (!row) return null;
    const owner = await ctx.db.get("users", row.userId);
    return { row, admin: owner?.role === "admin" };
  },
});

export const patch = internalMutation({
  args: { remakeId: v.id("remakes"), fields: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch("remakes", args.remakeId, args.fields as Partial<Doc<"remakes">>);
  },
});

// ── The pipeline ────────────────────────────────────────────────────────────
// One step per call, then it schedules itself again until done or failed:
// voicing: ElevenLabs reads one line per call (so no call outlasts Convex's
//   action limit); once all are read, a voice-over longer than was charged is
//   refused, else every segment goes to fal, product shots first (fal may refuse
//   the user's photo, and then nothing else has been paid for).
// rendering: poll the segments; once all have a video, submit fal's compose.
// composing: poll it; copy the MP4 into storage (fal's links expire).
// A brief fal error while polling just waits for the next poll; a failure
// cancels the fal jobs still running.

class StepError extends Error {}

async function voiceLine(text: string, voiceId: string, admin: boolean): Promise<Blob> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new StepError("The voice service isn't set up yet (ELEVENLABS_API_KEY).");
  const res = await fetch(`${ELEVEN_URL}/text-to-speech/${voiceId}?output_format=${ELEVEN_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) {
    throw new StepError(describeElevenError(res.status, await res.json().catch(() => null), admin));
  }
  return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
}

const jobOf = (seg: Segment): FalJob | null => (seg.statusUrl && seg.responseUrl ? { statusUrl: seg.statusUrl, responseUrl: seg.responseUrl } : null);

/** The job's status, with a brief fal error read as "not done yet". */
async function pollDone(key: string, job: FalJob): Promise<boolean> {
  try {
    return (await falStatus(key, job)) === "done";
  } catch (error) {
    if (isTransient(error)) return false;
    throw error;
  }
}

/** The finished job's video link, or null to try again on the next poll after a brief fal error. */
async function resultVideo(key: string, job: FalJob): Promise<string | null> {
  let result: unknown;
  try {
    result = await falResult(key, job);
  } catch (error) {
    if (isTransient(error)) return null;
    throw error;
  }
  const url = videoUrlOf(result);
  if (!url) throw new FalError(502, result);
  return url;
}

export const advance = internalAction({
  args: { remakeId: v.id("remakes") },
  // Typed by hand: advance schedules itself, which would otherwise make the generated api types circular.
  handler: async (ctx, args): Promise<void> => {
    const loaded: { row: Doc<"remakes">; admin: boolean } | null = await ctx.runQuery(internal.remake.load, { remakeId: args.remakeId });
    if (!loaded || !ACTIVE.has(loaded.row.status)) return;
    const { row, admin } = loaded;
    const segments = row.segments as Segment[];
    const key = process.env.FAL_KEY?.trim();
    const save = async (fields: Partial<Doc<"remakes">>): Promise<void> => {
      await ctx.runMutation(internal.remake.patch, { remakeId: row._id, fields });
    };
    const failWith = async (error: string): Promise<void> => {
      // Stop what fal is still rendering for this video, so a failure doesn't keep billing.
      if (key) {
        const running = segments.filter((seg) => !seg.videoUrl).map(jobOf);
        if (row.status === "composing") running.push(row.composeJob as FalJob);
        await Promise.all(running.filter((j): j is FalJob => !!j).map((j) => falCancel(key, j)));
      }
      await save({ status: "failed", error, finishedAt: Date.now() });
    };
    const next = (ms: number) => ctx.scheduler.runAfter(ms, internal.remake.advance, { remakeId: row._id });
    if (isStale(row, Date.now())) return await failWith(STALE_MESSAGE);
    if (!key) return await failWith("AI video isn't switched on yet (FAL_KEY).");
    const models = falModels(process.env);

    try {
      if (row.status === "voicing") {
        const seg = segments.find((s) => !s.audioId);
        if (seg) {
          const blob = await voiceLine(seg.text, row.voiceId, admin);
          const audioId: Id<"_storage"> = await ctx.storage.store(blob);
          seg.audioId = audioId;
          seg.audioUrl = (await ctx.storage.getUrl(audioId)) ?? undefined;
          seg.audioSeconds = mp3Seconds(blob.size);
          if (segments.some((s) => !s.audioId)) {
            await save({ segments });
            await next(0);
            return;
          }
        }
        const seconds = Math.round(segments.reduce((sum, s) => sum + (s.audioSeconds ?? 0), 0) * 100) / 100;
        if (seconds > maxVoicedSeconds(row.monthlySeconds + row.extraSeconds)) {
          return await failWith("The voice-over came out longer than the script. Shorten the lines and try again.");
        }
        const photoUrl = await ctx.storage.getUrl(row.productImageId);
        if (!photoUrl) return await failWith("The product photo is gone. Upload it again.");
        for (const s of [...segments.filter((x) => x.kind === "product"), ...segments.filter((x) => x.kind === "actor")]) {
          const job =
            s.kind === "actor"
              ? await falSubmit(key, models.actor, { image_url: `${appUrl()}/actors/${row.actorId}.jpg`, audio_url: s.audioUrl, resolution: "720p" })
              : await falSubmit(key, models.product, {
                  prompt: productPrompt(s.scene, row.product),
                  image_url: photoUrl,
                  duration: seedanceDuration(s.audioSeconds ?? 0),
                  resolution: "720p",
                  aspect_ratio: "9:16",
                  camera_fixed: false,
                });
          s.statusUrl = job.statusUrl;
          s.responseUrl = job.responseUrl;
        }
        await save({ status: "rendering", segments, seconds });
      } else if (row.status === "rendering") {
        for (const seg of segments) {
          const job = jobOf(seg);
          if (seg.videoUrl || !job || !(await pollDone(key, job))) continue;
          seg.videoUrl = (await resultVideo(key, job)) ?? undefined;
        }
        if (segments.every((seg) => seg.videoUrl)) {
          const composeJob = await falSubmit(key, models.compose, { tracks: composeTracks(segments, COMPOSE_KEEPS_VIDEO_AUDIO) });
          await save({ status: "composing", segments, composeJob });
        } else {
          await save({ segments });
        }
      } else if (row.status === "composing") {
        const job = row.composeJob as FalJob;
        const url = (await pollDone(key, job)) ? await resultVideo(key, job) : null;
        if (url) {
          const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new FalError(res.status, null);
          const videoId: Id<"_storage"> = await ctx.storage.store(new Blob([await res.arrayBuffer()], { type: "video/mp4" }));
          return await save({ status: "done", videoId, finishedAt: Date.now() });
        }
      }
    } catch (error) {
      if (error instanceof FalError) return await failWith(describeFalError(error.status, error.body, admin));
      if (error instanceof StepError) return await failWith(error.message);
      console.warn("Remake failed", error instanceof Error ? error.message : error);
      return await failWith("The AI video failed. Try again.");
    }
    await next(POLL_MS);
  },
});
