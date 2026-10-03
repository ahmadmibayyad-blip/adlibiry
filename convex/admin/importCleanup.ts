import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "./helpers";
import { markStatsDirty } from "../stats";

// Undo the last ad CSV import. Every ad from one import shares the same
// firstSeenAt (the import time, see src/lib/adCsv.ts buildAdRows), so the
// newest firstSeenAt among source "csv_import" ads is that whole file.

const BATCH = 200;

export const lastAdImport = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Index on (source, firstSeenAt): jumps to the newest CSV import instead
    // of walking every ad until one turns up.
    const newest = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import"))
      .order("desc")
      .first();
    if (!newest) return null;
    const at = newest.firstSeenAt;
    const rows = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import").eq("firstSeenAt", at))
      .take(5000);
    return { at, count: rows.length };
  },
});

// Deletes up to BATCH ads of that import per call; call again while remaining > 0.
export const removeAdImport = mutation({
  args: { at: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("ads")
      .withIndex("by_source_first_seen", (q) => q.eq("source", "csv_import").eq("firstSeenAt", args.at))
      .take(5000);
    const now = rows.slice(0, BATCH);
    for (const ad of now) {
      if (ad.externalKey) {
        const link = await ctx.db
          .query("syncLinks")
          .withIndex("by_kind_external", (q) => q.eq("kind", "ad").eq("externalId", ad.externalKey!))
          .unique();
        if (link) await ctx.db.delete("syncLinks", link._id);
      }
      await ctx.db.delete("ads", ad._id);
    }
    if (now.length) await markStatsDirty(ctx);
    return { deleted: now.length, remaining: rows.length - now.length };
  },
});
