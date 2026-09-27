import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";

// Push notifications use the subject portion of tokenIdentifier ("issuer|subject") as visitorId.
function visitorIdFromToken(tokenIdentifier: string): string {
  return tokenIdentifier.split("|")[1] ?? tokenIdentifier;
}

// ── In-app alert feed ────────────────────────────────────────────────────────

async function getCurrentUserOrThrow(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
  if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
  return user;
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return { page: [], isDone: true, continueCursor: "" };

    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) => q.eq("userId", user._id).eq("isRead", false))
      .take(100);
    return unread.length;
  },
});

export const markAsRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const notification = await ctx.db.get("notifications", args.id);
    if (!notification) throw new ConvexError({ code: "NOT_FOUND", message: "Notification not found" });
    if (notification.userId !== user._id) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your notification" });
    }
    await ctx.db.patch("notifications", args.id, { isRead: true });
    return { success: true };
  },
});

export const markAllAsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) => q.eq("userId", user._id).eq("isRead", false))
      .take(200);
    for (const n of unread) {
      await ctx.db.patch("notifications", n._id, { isRead: true });
    }
    return { count: unread.length };
  },
});

// ── Alert preferences ────────────────────────────────────────────────────────

const defaultPreferences = {
  watchedNiches: [] as string[],
  notifyNewWinners: true,
  notifyNewAdsInNiches: true,
  notifyTrackedStoreUpdates: true,
  emailDigestEnabled: false,
};

export const getPreferences = query({
  args: {},
  handler: async (ctx): Promise<Doc<"alertPreferences"> | (typeof defaultPreferences & { _id: null })> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ...defaultPreferences, _id: null };
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return { ...defaultPreferences, _id: null };
    const prefs = await ctx.db
      .query("alertPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    return prefs ?? { ...defaultPreferences, _id: null };
  },
});

export const updatePreferences = mutation({
  args: {
    watchedNiches: v.array(v.string()),
    notifyNewWinners: v.boolean(),
    notifyNewAdsInNiches: v.boolean(),
    notifyTrackedStoreUpdates: v.boolean(),
    emailDigestEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("alertPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const updatedAt = new Date().toISOString();
    if (existing) {
      await ctx.db.patch("alertPreferences", existing._id, { ...args, updatedAt });
    } else {
      await ctx.db.insert("alertPreferences", { userId: user._id, ...args, updatedAt });
    }
    return { success: true };
  },
});

// ── Internal: create notifications (called from scheduled/admin flows) ──────

export const createForUser = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    link: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      ...args,
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  },
});

// Used by admin create/update flows to notify users who watch a niche or track a store.
export const notifyUsersWatchingNiche = internalMutation({
  args: { niche: v.string(), title: v.string(), body: v.string(), link: v.string(), type: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const allPrefs = await ctx.db.query("alertPreferences").take(2000);
    const visitorIds: string[] = [];
    for (const pref of allPrefs) {
      if (!pref.notifyNewAdsInNiches) continue;
      if (!pref.watchedNiches.includes(args.niche)) continue;
      await ctx.db.insert("notifications", {
        userId: pref.userId,
        type: args.type,
        title: args.title,
        body: args.body,
        link: args.link,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      const user = await ctx.db.get("users", pref.userId);
      if (user) visitorIds.push(visitorIdFromToken(user.tokenIdentifier ?? user._id));
    }
    if (visitorIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendNotification, {
        visitorIds,
        title: args.title,
        body: args.body,
      });
    }
  },
});

export const notifyAllForNewWinner = internalMutation({
  args: { title: v.string(), body: v.string(), link: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const allPrefs = await ctx.db.query("alertPreferences").take(2000);
    const visitorIds: string[] = [];
    for (const pref of allPrefs) {
      if (!pref.notifyNewWinners) continue;
      await ctx.db.insert("notifications", {
        userId: pref.userId,
        type: "new_winner",
        title: args.title,
        body: args.body,
        link: args.link,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      const user = await ctx.db.get("users", pref.userId);
      if (user) visitorIds.push(visitorIdFromToken(user.tokenIdentifier ?? user._id));
    }
    if (visitorIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendNotification, {
        visitorIds,
        title: args.title,
        body: args.body,
      });
    }
  },
});

export const notifyTrackersOfStoreUpdate = internalMutation({
  args: { storeId: v.id("stores"), title: v.string(), body: v.string(), link: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const trackers = await ctx.db.query("trackedStores").take(2000);
    const relevant = trackers.filter((t) => t.storeId === args.storeId);
    const visitorIds: string[] = [];
    for (const t of relevant) {
      const pref = await ctx.db
        .query("alertPreferences")
        .withIndex("by_user", (q) => q.eq("userId", t.userId))
        .unique();
      if (pref && !pref.notifyTrackedStoreUpdates) continue;
      await ctx.db.insert("notifications", {
        userId: t.userId,
        type: "store_update",
        title: args.title,
        body: args.body,
        link: args.link,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      const user = await ctx.db.get("users", t.userId);
      if (user) visitorIds.push(visitorIdFromToken(user.tokenIdentifier ?? user._id));
    }
    if (visitorIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.sendNotification, {
        visitorIds,
        title: args.title,
        body: args.body,
      });
    }
  },
});
