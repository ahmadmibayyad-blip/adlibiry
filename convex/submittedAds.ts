import { markStatsDirty } from "./stats";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireAdmin } from "./admin/helpers";

// ── Chrome Extension: crowdsourced ad submissions ───────────────────────────

// Rate-limit-lite: cap total pending queue growth per visitor to reduce spam risk
// without needing a full rate limiter for this milestone's scope.
const MAX_PENDING_PER_VISITOR = 50;

export const submitFromExtension = internalMutation({
  args: {
    submitterVisitorId: v.string(),
    advertiserName: v.string(),
    platform: v.string(),
    headline: v.string(),
    bodyText: v.string(),
    creativeUrl: v.string(),
    landingPageUrl: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existingPending = await ctx.db
      .query("submittedAds")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(500);
    const fromSameVisitor = existingPending.filter(
      (a) => a.submitterVisitorId === args.submitterVisitorId
    );
    if (fromSameVisitor.length >= MAX_PENDING_PER_VISITOR) {
      return { success: false, reason: "rate_limited" };
    }

    await ctx.db.insert("submittedAds", {
      ...args,
      status: "pending",
      submittedAt: new Date().toISOString(),
    });
    return { success: true };
  },
});

// ── Admin moderation ─────────────────────────────────────────────────────────

export const listSubmitted = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("submittedAds")
      .withIndex("by_status", (q) => q.eq("status", args.status ?? "pending"))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getPendingCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("submittedAds")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(500);
    return pending.length;
  },
});

export const approveSubmission = mutation({
  args: {
    id: v.id("submittedAds"),
    niche: v.string(),
    country: v.string(),
    spendEstimate: v.string(),
    views: v.string(),
    aiScore: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const submission = await ctx.db.get("submittedAds", args.id);
    if (!submission) throw new ConvexError({ code: "NOT_FOUND", message: "Submission not found" });
    if (submission.status !== "pending") {
      throw new ConvexError({ code: "CONFLICT", message: "Submission already reviewed" });
    }
    if (args.aiScore < 0 || args.aiScore > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "AI score must be between 0 and 100" });
    }

    await markStatsDirty(ctx);
    await ctx.db.insert("ads", {
      advertiserName: submission.advertiserName,
      platform: submission.platform,
      country: args.country,
      niche: args.niche,
      headline: submission.headline,
      bodyText: submission.bodyText,
      creativeUrl: submission.creativeUrl,
      landingPageUrl: submission.landingPageUrl || submission.sourceUrl,
      spendEstimate: args.spendEstimate,
      likes: 0,
      views: args.views,
      daysRunning: 0,
      aiScore: args.aiScore,
      targeting: { ageRange: "Unknown", gender: "All", interests: [] },
      firstSeenAt: new Date().toISOString(),
      source: "extension",
    });

    await ctx.db.patch("submittedAds", args.id, { status: "approved" });
    return { success: true };
  },
});

export const rejectSubmission = mutation({
  args: { id: v.id("submittedAds") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const submission = await ctx.db.get("submittedAds", args.id);
    if (!submission) throw new ConvexError({ code: "NOT_FOUND", message: "Submission not found" });
    await ctx.db.patch("submittedAds", args.id, { status: "rejected" });
    return { success: true };
  },
});
