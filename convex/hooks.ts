import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { NICHES } from "./lib/category";
import { pickHooks } from "./lib/hooks";
import { requireAdmin } from "./admin/helpers";

// ── Hooks of the week ───────────────────────────────────────────────────────
// Every Monday (convex/hooksBuilder.ts) we take the most engaging ads found or
// seen in the last 7 days per niche, keep each ad's opening line ("hook"),
// and Claude labels the hook type, why it works and a reusable template.

const WEEK_MS = 7 * 86_400_000;

export const candidates = internalQuery({
  args: { niche: v.string() },
  handler: async (ctx, args) => {
    const since = Date.now() - WEEK_MS;
    const sinceIso = new Date(since).toISOString();
    const recent = await ctx.db
      .query("ads")
      .withIndex("by_niche", (q) => q.eq("niche", args.niche))
      .order("desc")
      .take(600);
    const fresh = recent.filter((a) => a._creationTime >= since || (a.lastSeenAt ?? "") >= sinceIso);
    return pickHooks(fresh).map((p) => ({ adId: p.ad._id, hook: p.hook, score: p.score }));
  },
});

const row = v.object({
  adId: v.id("ads"),
  hook: v.string(),
  score: v.number(),
  type: v.optional(v.string()),
  why: v.optional(v.string()),
  template: v.optional(v.string()),
});

export const saveNiche = internalMutation({
  args: { week: v.string(), niche: v.string(), rows: v.array(row) },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("weeklyHooks")
      .withIndex("by_week_niche", (q) => q.eq("week", args.week).eq("niche", args.niche))
      .collect();
    for (const o of old) await ctx.db.delete("weeklyHooks", o._id);
    const createdAt = new Date().toISOString();
    for (const [i, r] of args.rows.entries()) {
      await ctx.db.insert("weeklyHooks", { ...r, week: args.week, niche: args.niche, rank: i + 1, createdAt });
    }
  },
});

// The page: the latest week (or a chosen one), every niche, with each hook's ad.
export const latest = query({
  args: { week: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const week = args.week ?? (await ctx.db.query("weeklyHooks").withIndex("by_week").order("desc").first())?.week;
    if (!week) return null;
    const weeks = new Set<string>();
    for await (const r of ctx.db.query("weeklyHooks").withIndex("by_week").order("desc")) {
      weeks.add(r.week);
      if (weeks.size >= 8) break;
    }
    const niches: { niche: string; hooks: (Doc<"weeklyHooks"> & { ad: Doc<"ads"> | null })[] }[] = [];
    for (const niche of NICHES) {
      const rows = await ctx.db
        .query("weeklyHooks")
        .withIndex("by_week_niche", (q) => q.eq("week", week).eq("niche", niche))
        .collect();
      if (!rows.length) continue;
      niches.push({ niche, hooks: await Promise.all(rows.map(async (r) => ({ ...r, ad: await ctx.db.get("ads", r.adId) }))) });
    }
    return { week, weeks: [...weeks], niches };
  },
});

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return true;
  },
});
