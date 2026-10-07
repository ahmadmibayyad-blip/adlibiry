import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./admin/helpers";
import { pointEstimate } from "./lib/estimates";
import { urlKey } from "./lib/productMatch";
import { parseRangeBounds } from "./lib/rangeParsing";
import { storeOrigin } from "./lib/storeSales";
import { calibrate, type BasisCalibration } from "./lib/revenueModel";

// Known-truth revenue set: stores or products whose real monthly revenue we
// know (from owners, public reports). Admin adds 20–50 of them; a monthly job
// compares our estimates with them per estimation method, and the pipeline
// scales each method by its median error once it has 5+ examples
// (lib/revenueModel.ts factorFor).

export type RevenueCalibration = { at: string; rows: number; matched: number; byBasis: Record<string, BasisCalibration> };

export async function readCalibration(ctx: QueryCtx | MutationCtx): Promise<Record<string, BasisCalibration> | undefined> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "revenueCalibration")).unique();
  return (doc?.data as RevenueCalibration | undefined)?.byBasis;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("revenueTruth").order("desc").take(200);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "revenueCalibration")).unique();
    return { rows, calibration: (doc?.data as RevenueCalibration | undefined) ?? null };
  },
});

export const add = mutation({
  args: { kind: v.union(v.literal("store"), v.literal("product")), url: v.string(), monthlyRevenueUsd: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(args.monthlyRevenueUsd > 0)) throw new Error("Enter the monthly revenue in USD.");
    if (!storeOrigin(args.url)) throw new Error("Enter the store or product page address.");
    await ctx.db.insert("revenueTruth", { ...args, url: args.url.trim(), addedAt: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("revenueTruth") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete("revenueTruth", args.id);
  },
});

async function runCalibration(ctx: MutationCtx): Promise<RevenueCalibration> {
  const truth = await ctx.db.query("revenueTruth").take(200);
  const rows: { basis: string; truth: number; estimate: number }[] = [];
  for (const t of truth) {
    if (t.kind === "product") {
      const key = urlKey(t.url);
      const p = key ? await ctx.db.query("products").withIndex("by_url_key", (q) => q.eq("urlKey", key)).first() : null;
      const estimate = p ? pointEstimate(p.estRevenue) : undefined;
      if (p && estimate) rows.push({ basis: p.estBasis?.revenue ?? "unknown", truth: t.monthlyRevenueUsd, estimate });
    } else {
      const origin = storeOrigin(t.url);
      const host = origin ? new URL(origin).hostname.replace(/^www\./, "") : null;
      if (!host) continue;
      const store = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", host)).first();
      const b = store ? parseRangeBounds(store.estimatedRevenueRange) : undefined;
      const estimate = b ? Math.sqrt(Math.max(b.low, 1) * b.high) : undefined;
      if (estimate) rows.push({ basis: "store", truth: t.monthlyRevenueUsd, estimate });
    }
  }
  const data: RevenueCalibration = { at: new Date().toISOString(), rows: truth.length, matched: rows.length, byBasis: calibrate(rows) };
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "revenueCalibration")).unique();
  if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt: data.at });
  else await ctx.db.insert("siteStats", { key: "revenueCalibration", data, updatedAt: data.at });
  return data;
}

// Monthly (crons.ts), and from Admin.
export const calibrateMonthly = internalMutation({ args: {}, handler: async (ctx) => await runCalibration(ctx) });

export const calibrateNow = mutation({
  args: {},
  handler: async (ctx): Promise<RevenueCalibration> => {
    await requireAdmin(ctx);
    return await runCalibration(ctx);
  },
});
