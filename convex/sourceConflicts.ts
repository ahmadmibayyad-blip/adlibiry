import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin } from "./admin/helpers";
import type { Conflict } from "./lib/fusion";

// Sources disagreeing about the same field (lib/fusion.ts fuseAd): the higher
// priority source wins on the record, and the disagreement is kept here so an
// admin can sample-review it (Admin → Source fusion), like revenueTruth.

const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** One row per entity, field and day. */
export async function logConflicts(ctx: MutationCtx, entity: "ad" | "product", entityId: string, conflicts: Conflict[], day: string) {
  for (const c of conflicts) {
    const last = await ctx.db
      .query("sourceConflicts")
      .withIndex("by_entity_field", (q) => q.eq("entityId", entityId).eq("field", c.field))
      .order("desc")
      .first();
    if (last?.day === day) continue;
    await ctx.db.insert("sourceConflicts", { entity, entityId, field: c.field, values: c.values.map((x) => ({ source: x.source, value: x.value.slice(0, 200) })), day });
  }
}

/** Last 30 days by field, plus the newest unreviewed ones to sample. */
export const review = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db.query("sourceConflicts").withIndex("by_day", (q) => q.gte("day", dayMinus(today, 30))).order("desc").take(5000);
    const byField: Record<string, number> = {};
    for (const r of rows) byField[r.field] = (byField[r.field] ?? 0) + 1;
    return {
      total: rows.length,
      byField: Object.entries(byField).map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
      sample: rows.filter((r) => !r.reviewed).slice(0, 15),
    };
  },
});

export const markReviewed = mutation({
  args: { id: v.id("sourceConflicts") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch("sourceConflicts", args.id, { reviewed: true });
  },
});

/** Keep 90 days. */
export const prune = internalMutation({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("sourceConflicts").withIndex("by_day", (q) => q.lt("day", dayMinus(args.day, 90))).take(500);
    for (const r of old) await ctx.db.delete("sourceConflicts", r._id);
    return old.length;
  },
});
