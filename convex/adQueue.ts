import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import type { LaunchCopy } from "./lib/launchCopy";

// Ad approval queue (/dashboard/ad-queue): every ad Launch writes (its ad kit) and every variation the AI makes
// (adQueueAi.ts) waits here until the user approves, edits or rejects it. Nothing is posted anywhere: approved
// ads are ready to copy into Meta or TikTok. Ad images come from the launch (launchAds.ts), matched by ad number.

const MAX_TEXT = 2000;

async function me(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

export const mine = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) return null;
    const status = args.status === "approved" || args.status === "rejected" ? args.status : "pending";
    const rows = await ctx.db.query("adDrafts").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", status)).order("desc").take(100);
    const launches = new Map<string, Doc<"launches"> | null>();
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const s of ["pending", "approved", "rejected"] as const) {
      counts[s] = (await ctx.db.query("adDrafts").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", s)).take(500)).length;
    }
    const ads = [];
    for (const d of rows) {
      if (!launches.has(d.launchId)) launches.set(d.launchId, await ctx.db.get("launches", d.launchId));
      const l = launches.get(d.launchId);
      const image = l?.adImages?.find((i) => i.ad === d.adIndex)?.url;
      ads.push({ ...d, ...(image ? { imageUrl: image } : {}), productTitle: (l?.copy as LaunchCopy | undefined)?.title ?? "", storeUrl: l?.storeUrl });
    }
    return { counts, ads };
  },
});

/** Puts the ad kits of the user's launches that aren't in the queue yet into it (the page calls it when it opens). */
export const importLaunches = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const user = await me(ctx);
    if (!user) return 0;
    let added = 0;
    const launches = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
    for (const l of launches) {
      const kit = (l.copy as LaunchCopy | undefined)?.adKit ?? [];
      if (l.status !== "published" || !kit.length) continue;
      if (await ctx.db.query("adDrafts").withIndex("by_launch", (q) => q.eq("launchId", l._id)).first()) continue;
      for (const [adIndex, a] of kit.entries()) {
        await ctx.db.insert("adDrafts", { userId: user._id, launchId: l._id, adIndex, angle: a.angle, hook: a.hook, primaryText: a.primaryText, headline: a.headline, source: "launch", status: "pending", createdAt: Date.now() });
        added++;
      }
    }
    return added;
  },
});

async function own(ctx: QueryCtx, id: Id<"adDrafts">) {
  const user = await me(ctx);
  const d = await ctx.db.get("adDrafts", id);
  if (!user || !d || d.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Ad not found." });
  return d;
}

export const decide = mutation({
  args: { id: v.id("adDrafts"), status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("pending")) },
  handler: async (ctx, args) => {
    const d = await own(ctx, args.id);
    await ctx.db.patch("adDrafts", d._id, { status: args.status, decidedAt: Date.now() });
  },
});

export const edit = mutation({
  args: { id: v.id("adDrafts"), hook: v.string(), primaryText: v.string(), headline: v.string() },
  handler: async (ctx, args) => {
    const d = await own(ctx, args.id);
    await ctx.db.patch("adDrafts", d._id, {
      hook: args.hook.trim().slice(0, 300),
      primaryText: args.primaryText.trim().slice(0, MAX_TEXT),
      headline: args.headline.trim().slice(0, 200),
      editedAt: Date.now(),
    });
  },
});

/** For adQueueAi.variations: the ad, its launch's product facts, and whose it is. */
export const forVariations = internalQuery({
  args: { id: v.id("adDrafts"), token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    const d = await ctx.db.get("adDrafts", args.id);
    if (!user || !d || d.userId !== user._id) return null;
    const l = await ctx.db.get("launches", d.launchId);
    const copy = l?.copy as LaunchCopy | undefined;
    return { draft: d, product: copy ? { title: copy.title, subtitle: copy.subtitle, benefits: copy.benefits, language: l?.language ?? "English" } : null };
  },
});

export const addVariations = internalMutation({
  args: { from: v.id("adDrafts"), ads: v.array(v.object({ angle: v.string(), hook: v.string(), primaryText: v.string(), headline: v.string() })) },
  handler: async (ctx, args) => {
    const d = await ctx.db.get("adDrafts", args.from);
    if (!d) return;
    for (const a of args.ads) {
      await ctx.db.insert("adDrafts", {
        userId: d.userId, launchId: d.launchId, adIndex: d.adIndex,
        angle: a.angle.slice(0, 80), hook: a.hook.slice(0, 300), primaryText: a.primaryText.slice(0, MAX_TEXT), headline: a.headline.slice(0, 200),
        source: "variation", variationOf: d._id, status: "pending", createdAt: Date.now(),
      });
    }
  },
});
