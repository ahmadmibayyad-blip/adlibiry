import type { SiteStats } from "./stats";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireAdmin } from "./admin/helpers";
import { stableToken } from "./lib/authIdentity";
import { COMP_PRO_DAYS } from "./lib/billing";

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (user !== null) {
      return user._id;
    }
    return await ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: stableToken(identity),
      role: "user",
    });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
  },
});

// Internal versions for use from actions
export const getCurrentUserInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
  },
});

export const updateCustomerIdInternal = internalMutation({
  args: { customerId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    await ctx.db.patch("users", user._id, { customerId: args.customerId });
  },
});

// ── Admin ────────────────────────────────────────────────────────────────────

export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    return user?.role === "admin";
  },
});

export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const result = await ctx.db.query("users").order("desc").paginate(args.paginationOpts);
    let page = result.page;
    if (args.search) {
      const term = args.search.toLowerCase();
      page = page.filter(
        (u) =>
          (u.name ?? "").toLowerCase().includes(term) ||
          (u.email ?? "").toLowerCase().includes(term)
      );
    }
    return { ...result, page };
  },
});

export const setUserRole = mutation({
  args: { userId: v.id("users"), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (admin._id === args.userId && args.role !== "admin") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "You cannot remove your own admin access" });
    }
    await ctx.db.patch("users", args.userId, { role: args.role });
    return { success: true };
  },
});

// Free Pro for `days` (default 30) from now, or from the end of free Pro the
// user already has. days 0 removes it. The user gets a notification.
export const giveFreePro = mutation({
  args: { userId: v.id("users"), days: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ until: number | null }> => {
    await requireAdmin(ctx);
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    const days = args.days ?? COMP_PRO_DAYS;
    if (!Number.isInteger(days) || days < 0 || days > 366) throw new ConvexError({ code: "BAD_REQUEST", message: "Days must be 0–366." });
    if (days === 0) {
      await ctx.db.patch("users", user._id, { compProUntil: undefined });
      return { until: null };
    }
    const now = Date.now();
    const until = Math.max(now, user.compProUntil ?? 0) + days * 86_400_000;
    await ctx.db.patch("users", user._id, { compProUntil: until });
    await ctx.db.insert("notifications", {
      userId: user._id,
      type: "billing",
      title: `You have Pro free for ${days} days`,
      body: `Every result, Launch and the Pro limits are unlocked until ${new Date(until).toUTCString().slice(5, 16)}.`,
      link: "/dashboard/settings",
      isRead: false,
      createdAt: new Date(now).toISOString(),
    });
    return { until };
  },
});

export const getAdminStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
    const s = doc?.data as SiteStats | undefined;
    return {
      totalUsers: s?.users.total ?? 0,
      totalAdmins: s?.users.admins ?? 0,
      totalProducts: s?.products.total ?? 0,
      totalAds: s?.ads.total ?? 0,
      totalStores: s?.stores.total ?? 0,
    };
  },
});
