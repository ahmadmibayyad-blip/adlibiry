import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";

// Knowledge section read progress: the guides each user marked as read. The
// guides themselves are static content (src/data/knowledge.json).

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
