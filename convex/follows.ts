import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";

// ── Follow alerts ───────────────────────────────────────────────────────────
// Users follow advertisers (from an ad's page). Once a day, after the imports,
// every follower gets one alert per advertiser that launched new ads.
// Store alerts (new products, sales jumps) come from convex/storeSales.ts.

const MAX_FOLLOWS = 50;
const MAX_FOLLOWS_ADMIN = 500;
const STATE_KEY = "followAlerts";

async function currentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

const visitorId = (user: Doc<"users">) => (user.tokenIdentifier ?? user._id).split("|")[1] ?? user.tokenIdentifier ?? user._id;

export const isFollowing = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return false;
    const row = await ctx.db
      .query("followedAdvertisers")
      .withIndex("by_user_and_name", (q) => q.eq("userId", user._id).eq("name", args.name))
      .unique();
    return !!row;
  },
});

export const toggleFollow = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to follow advertisers." });
    const name = args.name.trim();
    if (!name || name.length > 200) throw new ConvexError({ code: "BAD_REQUEST", message: "Unknown advertiser" });
    const existing = await ctx.db
      .query("followedAdvertisers")
      .withIndex("by_user_and_name", (q) => q.eq("userId", user._id).eq("name", name))
      .unique();
    if (existing) {
      await ctx.db.delete("followedAdvertisers", existing._id);
      return { following: false };
    }
    const max = user.role === "admin" ? MAX_FOLLOWS_ADMIN : MAX_FOLLOWS;
    const count = (await ctx.db.query("followedAdvertisers").withIndex("by_user", (q) => q.eq("userId", user._id)).take(max)).length;
    if (count >= max) throw new ConvexError({ code: "LIMIT", message: `You can follow up to ${max} advertisers. Unfollow one first.` });
    await ctx.db.insert("followedAdvertisers", { userId: user._id, name, followedAt: new Date().toISOString() });
    return { following: true };
  },
});

// Alerts page: who I follow, with their ad count and newest ad.
export const listFollowing = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("followedAdvertisers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_FOLLOWS_ADMIN);
    return await Promise.all(
      rows.map(async (r) => {
        const ads = await ctx.db
          .query("ads")
          .withIndex("by_advertiser", (q) => q.eq("advertiserName", r.name))
          .order("desc")
          .take(100);
        return {
          _id: r._id,
          name: r.name,
          followedAt: r.followedAt,
          adCount: ads.length,
          avatar: ads.find((a) => a.advertiserAvatar)?.advertiserAvatar ?? null,
          latestAdId: ads[0]?._id ?? null,
        };
      }),
    );
  },
});

// Ad page: more ads from the same advertiser, newest first.
export const advertiserAds = query({
  args: { name: v.string(), excludeId: v.optional(v.id("ads")) },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const ads = await ctx.db
      .query("ads")
      .withIndex("by_advertiser", (q) => q.eq("advertiserName", args.name))
      .order("desc")
      .take(13);
    return ads.filter((a) => a._id !== args.excludeId).slice(0, 12);
  },
});

// ── Daily alerts ────────────────────────────────────────────────────────────

// Follows handled per batch. Each batch reads at most this many follows plus
// up to 50 ads per distinct advertiser in it, well inside one mutation's limits;
// the next batch is scheduled until every follow has been seen once.
const FOLLOWS_PER_BATCH = 50;

export const sendDailyAlerts = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ alerts: number }> => {
    const state = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", STATE_KEY)).unique();
    const now = Date.now();
    // First run: look back one day.
    const since: number = (state?.data as { lastRunAt?: number } | undefined)?.lastRunAt ?? now - 86_400_000;
    return await alertBatch(ctx, { since, now, cursor: null, alerts: 0 });
  },
});

export const continueDailyAlerts = internalMutation({
  args: { since: v.number(), now: v.number(), cursor: v.string(), alerts: v.number() },
  handler: async (ctx, args): Promise<{ alerts: number }> => await alertBatch(ctx, args),
});

async function alertBatch(
  ctx: MutationCtx,
  { since, now, cursor, alerts }: { since: number; now: number; cursor: string | null; alerts: number },
): Promise<{ alerts: number }> {
  // Sorted by advertiser, so one advertiser's followers are usually in one batch.
  const page = await ctx.db
    .query("followedAdvertisers")
    .withIndex("by_name")
    .paginate({ numItems: FOLLOWS_PER_BATCH, cursor });
  const byName = new Map<string, Id<"users">[]>();
  for (const f of page.page) byName.set(f.name, [...(byName.get(f.name) ?? []), f.userId]);

  const prefs = new Map<Id<"users">, boolean>();
  const wantsAlert = async (userId: Id<"users">) => {
    if (!prefs.has(userId)) {
      const p = await ctx.db.query("alertPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
      prefs.set(userId, p?.notifyFollowedAdvertisers !== false);
    }
    return prefs.get(userId)!;
  };

  for (const [name, userIds] of byName) {
    const fresh: Doc<"ads">[] = [];
    for await (const ad of ctx.db.query("ads").withIndex("by_advertiser", (q) => q.eq("advertiserName", name)).order("desc")) {
      if (ad._creationTime <= since || fresh.length >= 50) break;
      fresh.push(ad);
    }
    if (!fresh.length) continue;
    const n = fresh.length;
    const title = `${name} launched ${n === 50 ? "50+" : n} new ad${n === 1 ? "" : "s"}`;
    const body = fresh[0].headline ? `Newest: “${fresh[0].headline.slice(0, 120)}”` : "See the newest ad in Ad Spy.";
    const link = `/dashboard/ads/${fresh[0]._id}`;
    const visitorIds: string[] = [];
    for (const userId of userIds) {
      if (!(await wantsAlert(userId))) continue;
      await ctx.db.insert("notifications", {
        userId,
        type: "advertiser_ads",
        title,
        body,
        link,
        isRead: false,
        createdAt: new Date(now).toISOString(),
      });
      alerts++;
      const user = await ctx.db.get("users", userId);
      if (user) visitorIds.push(visitorId(user));
    }
    if (visitorIds.length) {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendNotification, { visitorIds, title, body });
    }
  }

  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.follows.continueDailyAlerts, { since, now, cursor: page.continueCursor, alerts });
    return { alerts };
  }
  // Every follow has been seen: record the run so the next one starts here.
  const state = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", STATE_KEY)).unique();
  const data = { lastRunAt: now, lastAlerts: alerts };
  if (state) await ctx.db.patch("siteStats", state._id, { data, updatedAt: new Date(now).toISOString() });
  else await ctx.db.insert("siteStats", { key: STATE_KEY, data, updatedAt: new Date(now).toISOString() });
  return { alerts };
}
