import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin/helpers";
import { stableToken } from "./lib/authIdentity";
import { contentFields, contentProblems } from "./lib/knowledge";

// Knowledge section: the guides as edited by admins (one row; none means the
// built-in src/data/knowledge.json), and each user's read progress.

/** The admin-edited guides, or null when the built-in ones are used. */
export const content = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("knowledgeContent").first();
    if (!row) return null;
    return { reviewed: row.reviewed, topics: row.topics, glossary: row.glossary, updatedAt: row.updatedAt };
  },
});

/**
 * Saves an admin's edited copy of all the guides. `baseUpdatedAt` is the
 * version the editor started from, so one admin can't overwrite another's
 * newer save by accident. Returns the new version.
 */
export const saveContent = mutation({
  args: { ...contentFields, baseUpdatedAt: v.union(v.string(), v.null()) },
  handler: async (ctx, { baseUpdatedAt, ...c }) => {
    const admin = await requireAdmin(ctx);
    const problems = contentProblems(c);
    if (problems.length) throw new ConvexError({ code: "INVALID", message: problems[0], problems });
    const row = await ctx.db.query("knowledgeContent").first();
    if ((row?.updatedAt ?? null) !== baseUpdatedAt) {
      throw new ConvexError({ code: "CONFLICT", message: "Someone saved the guides after you opened the editor. Reload to see their changes." });
    }
    const updatedAt = new Date().toISOString();
    if (row) await ctx.db.replace("knowledgeContent", row._id, { ...c, updatedAt, updatedBy: admin._id });
    else await ctx.db.insert("knowledgeContent", { ...c, updatedAt, updatedBy: admin._id });
    return updatedAt;
  },
});

/** Throws away the admins' edits so the built-in guides show again. */
export const resetContent = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const row = await ctx.db.query("knowledgeContent").first();
    if (row) await ctx.db.delete("knowledgeContent", row._id);
  },
});

const GUIDE_ID = /^[a-z0-9-]{1,80}$/;

/** The ids of the guides the signed-in user has read ([] when signed out). */
export const myReads = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) return [];
    const rows = await ctx.db.query("knowledgeProgress").withIndex("by_user_guide", (q) => q.eq("userId", user._id)).take(500);
    return rows.map((r) => r.guideId);
  },
});

/** Marks a guide read, or unread again; returns whether it's now read. */
export const toggleRead = mutation({
  args: { guideId: v.string() },
  handler: async (ctx, args) => {
    if (!GUIDE_ID.test(args.guideId)) throw new Error("Unknown guide");
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in to track your progress.");
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) throw new Error("Please sign in to track your progress.");
    const row = await ctx.db
      .query("knowledgeProgress")
      .withIndex("by_user_guide", (q) => q.eq("userId", user._id).eq("guideId", args.guideId))
      .unique();
    if (row) {
      await ctx.db.delete("knowledgeProgress", row._id);
      return false;
    }
    await ctx.db.insert("knowledgeProgress", { userId: user._id, guideId: args.guideId, readAt: new Date().toISOString() });
    return true;
  },
});
