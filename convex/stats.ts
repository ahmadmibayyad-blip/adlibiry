import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./admin/helpers";
import type { Doc } from "./_generated/dataModel";

// Everything the UI needs that would otherwise require scanning whole tables
// (filter-dropdown counts, niche lists, admin totals) is computed here at most
// every few minutes, and read by pages as one small document.

type Count = { value: string; n: number };
export type SiteStats = {
  ads: { total: number; activeCount: number; videoCount: number; ctas: Count[]; countries: Count[]; niches: Count[]; platforms: Count[]; languages?: Count[] };
  products: { total: number; categories: Count[]; sources?: Count[] };
  users: { total: number; admins: number };
  stores: { total: number };
};

const EMPTY: SiteStats = {
  ads: { total: 0, activeCount: 0, videoCount: 0, ctas: [], countries: [], niches: [], platforms: [] },
  products: { total: 0, categories: [] },
  users: { total: 0, admins: 0 },
  stores: { total: 0 },
};

const count = (vals: (string | undefined)[]): Count[] => {
  const m = new Map<string, number>();
  for (const x of vals) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
};

// What scanPage keeps of each document (only the fields the counts need).
type ScanRow = { a?: boolean; v?: boolean; cta?: string; c?: (string | undefined)[]; n?: string; p?: string; l?: string; s?: string; admin?: boolean };

async function readStats(ctx: QueryCtx): Promise<SiteStats> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
  return (doc?.data as SiteStats | undefined) ?? EMPTY;
}

// One page of a table reduced to the few fields stats need.
export const scanPage = internalQuery({
  args: { table: v.union(v.literal("ads"), v.literal("products"), v.literal("users"), v.literal("stores")), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const res = await ctx.db.query(table).paginate({ numItems: 1000, cursor });
    const rows: ScanRow[] =
      table === "ads"
        ? (res.page as Doc<"ads">[]).map((d) => ({
            a: d.isActive === true,
            v: d.mediaType === "video" || !!d.videoUrl,
            cta: d.ctaText,
            c: [...new Set([d.country, ...(d.countries ?? [])])],
            n: d.niche,
            p: d.platform,
            l: d.language,
          }))
        : table === "products"
          ? (res.page as Doc<"products">[]).map((d) => ({ n: d.category, s: d.source ?? "curated" }))
          : table === "users"
            ? (res.page as Doc<"users">[]).map((d) => ({ admin: d.role === "admin" }))
            : res.page.map(() => ({}));
    return { rows, isDone: res.isDone, cursor: res.continueCursor };
  },
});

export const save = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const now = new Date().toISOString();
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt: now });
    else await ctx.db.insert("siteStats", { key: "main", data, updatedAt: now });
    const pending = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "pending")).unique();
    if (pending) await ctx.db.delete("siteStats", pending._id);
    return null;
  },
});

export const recompute = internalAction({
  args: {},
  handler: async (ctx) => {
    const stats: SiteStats = structuredClone(EMPTY);
    const scan = async (table: "ads" | "products" | "users" | "stores", each: (r: ScanRow) => void) => {
      let cursor: string | null = null;
      for (;;) {
        const res: { rows: ScanRow[]; isDone: boolean; cursor: string } = await ctx.runQuery(internal.stats.scanPage, { table, cursor });
        res.rows.forEach(each);
        if (res.isDone) break;
        cursor = res.cursor;
      }
    };
    // count() skips empty values, so a missing field just isn't counted.
    const ctas: string[] = [], countries: string[] = [], langs: string[] = [];
    const niches: (string | undefined)[] = [], platforms: (string | undefined)[] = [], cats: (string | undefined)[] = [], psources: (string | undefined)[] = [];
    await scan("ads", (r) => {
      stats.ads.total++;
      if (r.a) stats.ads.activeCount++;
      if (r.v) stats.ads.videoCount++;
      if (r.cta) ctas.push(r.cta);
      for (const c of r.c ?? []) if (c && c !== "INTL") countries.push(c);
      niches.push(r.n);
      platforms.push(r.p);
      if (r.l) langs.push(r.l);
    });
    await scan("products", (r) => {
      stats.products.total++;
      cats.push(r.n);
      psources.push(r.s);
    });
    await scan("users", (r) => {
      stats.users.total++;
      if (r.admin) stats.users.admins++;
    });
    await scan("stores", () => stats.stores.total++);
    stats.ads.ctas = count(ctas).slice(0, 20);
    stats.ads.countries = count(countries);
    stats.ads.niches = count(niches);
    stats.ads.platforms = count(platforms);
    stats.ads.languages = count(langs).slice(0, 30);
    stats.products.categories = count(cats);
    stats.products.sources = count(psources);
    await ctx.runMutation(internal.stats.save, { data: stats });
    return null;
  },
});

// Call after writes that change counts. Schedules one rebuild REBUILD_DELAY_MS
// out; further calls in that window are free (they only read a tiny flag row).
// A rebuild scans ads, products, users and stores, so during a long import this
// waits 30 minutes rather than 5: a few scans instead of a dozen or more. Counts
// can lag by up to that much; the daily 09:05 rebuild (crons.ts) is always exact.
// (Exact incremental counters would need every write path that touches these
// fields to update them; one missed path and the numbers drift.)
const REBUILD_DELAY_MS = 30 * 60 * 1000;
export async function markStatsDirty(ctx: MutationCtx) {
  const pending = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "pending")).unique();
  if (pending) return;
  await ctx.db.insert("siteStats", { key: "pending", data: null, updatedAt: new Date().toISOString() });
  await ctx.scheduler.runAfter(REBUILD_DELAY_MS, internal.stats.recompute, {});
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const s = await readStats(ctx);
    return { ads: s.ads, products: s.products };
  },
});

export const adminTotals = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const s = await readStats(ctx);
    return {
      totalUsers: s.users.total,
      totalAdmins: s.users.admins,
      totalProducts: s.products.total,
      totalAds: s.ads.total,
      totalStores: s.stores.total,
    };
  },
});

export const refreshNow = internalMutation({ args: { reason: v.optional(v.string()) }, handler: async (ctx) => markStatsDirty(ctx) });

export const rebuildNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.stats.recompute, {});
    return null;
  },
});
