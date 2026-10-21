import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { FalError, describeFalError, falCancel, falResult, falStatus, falSubmit, isTransient, videoUrlOf, type FalJob } from "./lib/fal";
import { POLL_MS, photoProblem, splitCharge } from "./lib/remake";
import { STUDIO_MODELS, chargeFor, falInput, validateRequest } from "./lib/studio";
import { STALE_MESSAGE, balance, checkCanStart, currentUser, fail, isStale } from "./remake";

// ── AI Studio → Playground ──────────────────────────────────────────────────
// A prompt (and optional product photo) becomes a clip from one fal model (lib/studio.ts). `start` checks the
// request and the user's AI-video seconds (shared with remakes), charges length × the model's multiplier and
// schedules `advance`: submit to fal, poll every 10 s, copy the MP4 into storage. Failed and lost clips are free.

const randomSeed = () => Math.floor(Math.random() * 2_147_483_647);

export const models = query({
  args: {},
  handler: async () =>
    STUDIO_MODELS.map((m) => ({
      key: m.key,
      name: m.name,
      blurb: m.blurb,
      lengths: m.lengths,
      aspects: m.aspects,
      photoAspect: m.photoAspect,
      multiplier: m.multiplier,
      needsPhoto: !m.textEndpoint,
    })),
});

export const start = mutation({
  args: {
    model: v.string(),
    prompt: v.string(),
    aspect: v.string(),
    length: v.number(),
    imageId: v.optional(v.id("_storage")),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"studioClips">> => {
    const user = await currentUser(ctx);
    if (!user) throw fail("UNAUTHENTICATED", "Please sign in first.");
    if (!process.env.FAL_KEY) throw fail("NOT_CONFIGURED", "AI video isn't switched on yet (FAL_KEY).");
    let checked: ReturnType<typeof validateRequest>;
    try {
      checked = validateRequest({ ...args, hasPhoto: !!args.imageId });
    } catch (error) {
      throw fail("BAD_REQUEST", error instanceof Error ? error.message : "Check the clip's settings.");
    }
    if (args.imageId) {
      const photoError = photoProblem(await ctx.db.system.get(args.imageId));
      if (photoError) throw fail("BAD_PHOTO", photoError);
    }
    const seconds = chargeFor(checked.model, checked.length);
    const now = Date.now();
    const b = await balance(ctx, user, now);
    if (b.limit === 0 && b.extra === 0) throw fail("LIMIT", "AI videos come with Pro.");
    const charge = splitCharge(seconds, b.limit === null ? null : b.limit - b.used, b.extra);
    if (!charge) {
      const left = Math.max(0, (b.limit ?? 0) - b.used) + b.extra;
      const buy = b.canBuy ? ` Buy ${b.pack.seconds} more seconds for €${b.pack.cents / 100}.` : "";
      throw fail("LIMIT", `You have ${left} second${left === 1 ? "" : "s"} of AI video left.${buy}`);
    }
    await checkCanStart(ctx, user, now);
    const clipId = await ctx.db.insert("studioClips", {
      userId: user._id,
      model: checked.model.key,
      prompt: checked.prompt,
      imageId: args.imageId,
      aspect: checked.aspect,
      length: checked.length,
      seed: checked.model.seeded ? (args.seed ?? randomSeed()) : undefined,
      status: "rendering",
      seconds,
      monthlySeconds: charge.monthly,
      extraSeconds: charge.extra,
      startedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.studio.advance, { clipId });
    return clipId;
  },
});

/** The user's newest clip, for the Playground's progress line and takes. */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const c = await ctx.db.query("studioClips").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").first();
    if (!c) return null;
    const stale = isStale(c, Date.now());
    return {
      _id: c._id,
      status: stale ? "failed" : c.status,
      error: stale ? STALE_MESSAGE : (c.error ?? null),
      videoUrl: c.status === "done" && c.videoId ? await ctx.storage.getUrl(c.videoId) : null,
      model: c.model,
      prompt: c.prompt,
      aspect: c.aspect,
      length: c.length,
      seed: c.seed ?? null,
      imageId: c.imageId ?? null,
      seconds: c.seconds,
    };
  },
});

// Bounded by ATTEMPTS_PER_DAY (5 a day), so this covers well over a year of videos.
const MAX_MY_VIDEOS = 600;

type MyVideo = { kind: "ugc" | "clip"; id: string; title: string; videoUrl: string; at: number; adId?: Id<"ads"> };

/** My videos: finished UGC videos and Playground clips, newest first; the page asks for 30 more at a time ("Show more"). */
export const mine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<MyVideo[]> => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const limit = Math.min(MAX_MY_VIDEOS, Math.max(1, Math.floor(args.limit ?? 30)));
    const out: MyVideo[] = [];
    // Recent rows include failed ones, so read a few more than shown.
    for (const r of await ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(limit * 3)) {
      const url = r.status === "done" && r.videoId ? await ctx.storage.getUrl(r.videoId) : null;
      if (url) out.push({ kind: "ugc", id: r._id, title: r.product, videoUrl: url, at: r.startedAt, adId: r.adId });
    }
    for (const c of await ctx.db.query("studioClips").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(limit * 3)) {
      const url = c.status === "done" && c.videoId ? await ctx.storage.getUrl(c.videoId) : null;
      if (url) out.push({ kind: "clip", id: c._id, title: c.prompt, videoUrl: url, at: c.startedAt });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  },
});

export const load = internalQuery({
  args: { clipId: v.id("studioClips") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("studioClips", args.clipId);
    if (!row) return null;
    const owner = await ctx.db.get("users", row.userId);
    const imageUrl = row.imageId ? await ctx.storage.getUrl(row.imageId) : null;
    return { row, admin: owner?.role === "admin", imageUrl };
  },
});

export const patch = internalMutation({
  args: { clipId: v.id("studioClips"), fields: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch("studioClips", args.clipId, args.fields as Partial<Doc<"studioClips">>);
  },
});

/** The finished job's video link, or null to try again on the next poll (not done, or a brief fal error). */
async function finishedVideo(key: string, job: FalJob): Promise<string | null> {
  try {
    if ((await falStatus(key, job)) !== "done") return null;
    const result = await falResult(key, job);
    const url = videoUrlOf(result);
    if (!url) throw new FalError(502, result);
    return url;
  } catch (error) {
    if (isTransient(error)) return null;
    throw error;
  }
}

export const advance = internalAction({
  args: { clipId: v.id("studioClips") },
  // Typed by hand: advance schedules itself, which would otherwise make the generated api types circular.
  handler: async (ctx, args): Promise<void> => {
    const loaded: { row: Doc<"studioClips">; admin: boolean; imageUrl: string | null } | null = await ctx.runQuery(internal.studio.load, args);
    if (!loaded || loaded.row.status !== "rendering") return;
    const { row, admin, imageUrl } = loaded;
    const key = process.env.FAL_KEY?.trim();
    const job = row.job as FalJob | undefined;
    const save = (fields: Partial<Doc<"studioClips">>) => ctx.runMutation(internal.studio.patch, { clipId: row._id, fields });
    const failWith = async (error: string): Promise<void> => {
      if (key && job) await falCancel(key, job);
      await save({ status: "failed", error, finishedAt: Date.now() });
    };
    if (isStale(row, Date.now())) return await failWith(STALE_MESSAGE);
    if (!key) return await failWith("AI video isn't switched on yet (FAL_KEY).");

    try {
      if (!job) {
        const model = STUDIO_MODELS.find((m) => m.key === row.model);
        if (!model) return await failWith("This model isn't available anymore. Pick another one.");
        if (row.imageId && !imageUrl) return await failWith("The product photo is gone. Upload it again.");
        const { endpoint, body } = falInput(model, { prompt: row.prompt, aspect: row.aspect as never, length: row.length }, imageUrl, row.seed ?? null);
        await save({ job: await falSubmit(key, endpoint, body) });
      } else {
        const url = await finishedVideo(key, job);
        if (url) {
          const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new FalError(res.status, null);
          const videoId: Id<"_storage"> = await ctx.storage.store(new Blob([await res.arrayBuffer()], { type: "video/mp4" }));
          await save({ status: "done", videoId, finishedAt: Date.now() });
          return;
        }
      }
    } catch (error) {
      if (error instanceof FalError) return await failWith(describeFalError(error.status, error.body, admin));
      console.warn("Studio clip failed", error instanceof Error ? error.message : error);
      return await failWith("The AI video failed. Try again.");
    }
    await ctx.scheduler.runAfter(POLL_MS, internal.studio.advance, { clipId: row._id });
  },
});
