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
    let at: string | null = null;
    for await (const ad of ctx.db.query("ads").withIndex("by_first_seen").order("desc")) {
      if (ad.source === "csv_import") {
        at = ad.firstSeenAt;
        break;
      }
    }
    if (!at) return null;
    const rows = await ctx.db
      .query("ads")
      .withIndex("by_first_seen", (q) => q.eq("firstSeenAt", at))
      .take(5000);
    return { at, count: rows.filter((a) => a.source === "csv_import").length };
  },
});

// Deletes up to BATCH ads of that import per call; call again while remaining > 0.
export const removeAdImport = mutation({
  args: { at: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = (
      await ctx.db
        .query("ads")
        .withIndex("by_first_seen", (q) => q.eq("firstSeenAt", args.at))
        .take(5000)
    ).filter((a) => a.source === "csv_import");
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
