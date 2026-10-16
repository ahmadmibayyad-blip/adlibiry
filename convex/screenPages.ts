import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import { SCREEN_PAGE_RUNS, pageTitle } from "./lib/screenPage";

// Screenshot to page (/dashboard/page-builder): the pages a user made from screenshots, and how many
// they may make or change a day. The AI work is in screenPagesAi.ts.

const DAY_MS = 86_400_000;

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function usage(ctx: { db: QueryCtx["db"] }, user: Doc<"users">) {
  const limit = byTier(user, SCREEN_PAGE_RUNS);
  const runs = await ctx.db
    .query("screenPageRuns")
    .withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS))
    .take(limit);
  return { used: runs.length, limit };
}

const limitMessage = (limit: number) =>
  limit <= SCREEN_PAGE_RUNS.trial ? `You've made ${limit} pages today. Upgrade to Pro for ${SCREEN_PAGE_RUNS.paid} a day.` : `You've made or changed ${limit} pages today. Try again tomorrow.`;

/** The user's pages (newest first, without their HTML) and today's allowance. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const rows = await ctx.db.query("screenPages").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(30);
    return {
      ...(await usage(ctx, user)),
      pages: rows.map((p) => ({ _id: p._id, title: p.title, status: p.status, updatedAt: p.updatedAt })),
    };
  },
});

export const get = query({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) return null;
    const imageUrls = (await Promise.all(p.imageIds.map((id) => ctx.storage.getUrl(id)))).filter((u): u is string => !!u);
    return { ...p, imageUrls, canUndo: !!p.previousHtml };
  },
});

export const remove = mutation({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
    for (const id of p.imageIds) await ctx.storage.delete(id).catch(() => {});
    await ctx.db.delete("screenPages", p._id);
  },
});

/** Back to the HTML before the last change (once). */
export const undo = mutation({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
    if (!p.previousHtml || p.status === "making") return;
    await ctx.db.patch("screenPages", p._id, { html: p.previousHtml, previousHtml: undefined, lastChange: undefined, updatedAt: Date.now() });
  },
});

/** Who is asking and whether today's allowance has room. */
export const before = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const u = await usage(ctx, user);
    return { userId: user._id, ...u, message: u.used >= u.limit ? limitMessage(u.limit) : null };
  },
});

export const insert = internalMutation({
  args: { userId: v.id("users"), imageIds: v.array(v.id("_storage")), notes: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"screenPages">> => {
    const now = Date.now();
    await ctx.db.insert("screenPageRuns", { userId: args.userId, at: now });
    return ctx.db.insert("screenPages", { ...args, title: "New page", status: "making", createdAt: now, updatedAt: now });
  },
});

/** Marks a ready page as being changed; null when it can't be (not theirs, or busy). */
export const startEdit = internalMutation({
  args: { id: v.id("screenPages"), userId: v.id("users"), change: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || p.userId !== args.userId) return "Page not found.";
    if (p.status === "making") return "This page is still being made. Wait a moment.";
    if (!p.html) return "This page has no HTML to change. Make it again from the screenshot.";
    await ctx.db.insert("screenPageRuns", { userId: args.userId, at: Date.now() });
    await ctx.db.patch("screenPages", p._id, { status: "making", pending: args.change, error: undefined });
    return null;
  },
});

export const context = internalQuery({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return null;
    const user = await ctx.db.get("users", p.userId);
    return { page: p, isAdmin: user?.role === "admin" };
  },
});

export const finish = internalMutation({
  args: { id: v.id("screenPages"), html: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return;
    await ctx.db.patch("screenPages", p._id, {
      html: args.html,
      previousHtml: p.html,
      lastChange: p.pending,
      pending: undefined,
      title: p.html ? p.title : pageTitle(args.html),
      status: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const fail = internalMutation({
  args: { id: v.id("screenPages"), error: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return;
    // A failed change keeps the page as it was.
    await ctx.db.patch("screenPages", p._id, { status: p.html ? "ready" : "failed", error: args.error.slice(0, 400), pending: undefined, updatedAt: Date.now() });
  },
});
