import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAdmin } from "./helpers";
import { internal } from "../_generated/api";

// Admin: manually record a store activity update (new ad count / best seller change)
// and alert everyone tracking that store. In a live Tier-2/3 integration this would
// be triggered automatically when a scraper/API detects a real change.
export const recordStoreUpdate = mutation({
  args: {
    storeId: v.id("stores"),
    newActiveAdsCount: v.number(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) throw new ConvexError({ code: "NOT_FOUND", message: "Store not found" });

    await ctx.db.patch("stores", args.storeId, { activeAdsCount: args.newActiveAdsCount });

    await ctx.scheduler.runAfter(0, internal.notifications.notifyTrackersOfStoreUpdate, {
      storeId: args.storeId,
      title: `${store.name} update`,
      body: args.note,
      link: `/dashboard/stores`,
    });

    return { success: true };
  },
});
