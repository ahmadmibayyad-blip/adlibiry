import { markStatsDirty } from "../stats";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "./helpers";
import { internal } from "../_generated/api";

// ── Admin: Ad Spy management ────────────────────────────────────────────────

export const listAds = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const result = await ctx.db.query("ads").withIndex("by_first_seen").order("desc").paginate(args.paginationOpts);
    let page = result.page;
    if (args.search) {
      const term = args.search.toLowerCase();
      page = page.filter(
        (a) => a.advertiserName.toLowerCase().includes(term) || a.headline.toLowerCase().includes(term)
      );
    }
    return { ...result, page };
  },
});

const adFields = {
  advertiserName: v.string(),
  platform: v.string(),
  country: v.string(),
  niche: v.string(),
  headline: v.string(),
  bodyText: v.string(),
  creativeUrl: v.string(),
  landingPageUrl: v.string(),
  spendEstimate: v.string(),
  likes: v.number(),
  views: v.string(),
  daysRunning: v.number(),
  aiScore: v.number(),
  targeting: v.object({
    ageRange: v.string(),
    gender: v.string(),
    interests: v.array(v.string()),
  }),
  source: v.string(),
};

export const createAd = mutation({
  args: adFields,
  handler: async (ctx, args): Promise<Id<"ads">> => {
    await requireAdmin(ctx);
    if (args.aiScore < 0 || args.aiScore > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "AI score must be between 0 and 100" });
    }
    await markStatsDirty(ctx);
    const adId = await ctx.db.insert("ads", {
      ...args,
      firstSeenAt: new Date().toISOString(),
    });

    await ctx.scheduler.runAfter(0, internal.notifications.notifyUsersWatchingNiche, {
      niche: args.niche,
      type: "new_ad",
      title: `New ${args.niche} ad spotted`,
      body: `${args.advertiserName} launched a new ad on ${args.platform}.`,
      link: `/dashboard/ad-spy`,
    });

    return adId;
  },
});

export const updateAd = mutation({
  args: { id: v.id("ads"), ...adFields },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { id, ...fields } = args;
    if (fields.aiScore < 0 || fields.aiScore > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "AI score must be between 0 and 100" });
    }
    const existing = await ctx.db.get("ads", id);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND", message: "Ad not found" });
    await ctx.db.patch("ads", id, fields);
    return { success: true };
  },
});

export const deleteAd = mutation({
  args: { id: v.id("ads") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.get("ads", args.id);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND", message: "Ad not found" });
    await markStatsDirty(ctx);
    await ctx.db.delete("ads", args.id);
    return { success: true };
  },
});
