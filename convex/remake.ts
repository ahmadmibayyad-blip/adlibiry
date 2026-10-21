import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { tierOf } from "./lib/billing";
import {
  MAX_LINES, MAX_SECONDS, REMAKE_ACTORS, STALE_MS, estimateSeconds, monthStart, photoProblem, planShots, remakePack, remakeSecondsLimit, splitCharge,
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
  handler: async (ctx, args) => await ctx.db.get("remakes", args.remakeId),
});

export const patch = internalMutation({
  args: { remakeId: v.id("remakes"), fields: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch("remakes", args.remakeId, args.fields as Partial<Doc<"remakes">>);
  },
});

// The pipeline (voice → render → compose); filled in by the next step of the plan.
export const advance = internalAction({
  args: { remakeId: v.id("remakes") },
  handler: async () => {},
});
