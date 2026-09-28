import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireAdmin } from "./admin/helpers";
import { upsertAd } from "./sources/links";
import { defined } from "./lib/adFields";
import { daysSince } from "./lib/extensionSubmission";

// ── Chrome Extension: crowdsourced ad submissions ───────────────────────────

// Rate-limit-lite: cap total pending queue growth per visitor to reduce spam risk
// without needing a full rate limiter for this milestone's scope.
const MAX_PENDING_PER_VISITOR = 50;

const submissionFields = {
  submitterVisitorId: v.string(),
  advertiserName: v.string(),
  platform: v.string(),
  headline: v.string(),
  bodyText: v.string(),
  creativeUrl: v.string(),
  landingPageUrl: v.string(),
  sourceUrl: v.string(),
  adKey: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  ctaText: v.optional(v.string()),
  advertiserAvatar: v.optional(v.string()),
  mediaType: v.optional(v.string()),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  shares: v.optional(v.number()),
  impressions: v.optional(v.number()),
  countries: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  startedAt: v.optional(v.string()),
  adLibraryUrl: v.optional(v.string()),
};

export const submitFromExtension = internalMutation({
  args: submissionFields,
  handler: async (ctx, args) => {
    // The same ad is seen by many users and on every scroll past it. One
    // submission per ad: a repeat refreshes the pending row's metrics instead
    // of flooding the moderation queue with duplicates.
    if (args.adKey) {
      const existing = await ctx.db
        .query("submittedAds")
        .withIndex("by_ad_key", (q) => q.eq("adKey", args.adKey))
        .first();
      if (existing) {
        if (existing.status === "pending") {
          await ctx.db.patch("submittedAds", existing._id, defined({ ...args, submitterVisitorId: undefined }));
        }
        return { success: true, duplicate: true };
      }
    }

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
    const country = args.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) && country !== "INTL") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Country must be a 2-letter code (e.g. DK) or INTL" });
    }
    if (!args.niche.trim()) throw new ConvexError({ code: "BAD_REQUEST", message: "Niche is required" });

    // Carry everything the extension scraped into Ad Spy, keyed by the ad's
    // stable id so re-approving or an Apify import of the same Meta ad updates
    // one row instead of creating duplicates.
    const days = daysSince(submission.startedAt);
    await upsertAd(ctx, {
      externalId: submission.adKey ?? `ext:sub_${submission._id}`,
      source: "extension",
      advertiserName: submission.advertiserName,
      platform: submission.platform,
      country,
      niche: args.niche.trim(),
      headline: submission.headline,
      bodyText: submission.bodyText,
      creativeUrl: submission.creativeUrl,
      landingPageUrl: submission.landingPageUrl || submission.sourceUrl,
      spendEstimate: args.spendEstimate.trim() || "Unknown",
      likes: submission.likes ?? 0,
      views: args.views.trim() || "0",
      daysRunning: days,
      aiScore: Math.round(args.aiScore),
      firstSeenAt: submission.startedAt ?? submission.submittedAt,
      mediaType: submission.mediaType,
      videoUrl: submission.videoUrl,
      advertiserAvatar: submission.advertiserAvatar,
      ctaText: submission.ctaText,
      impressions: submission.impressions,
      comments: submission.comments,
      shares: submission.shares,
      isActive: submission.isActive,
      countries: submission.countries,
      adLibraryUrl: submission.adLibraryUrl,
      lastSeenAt: submission.submittedAt,
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
