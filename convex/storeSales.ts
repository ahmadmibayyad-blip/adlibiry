import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { monthlyRevenueRange, storeAlert, storeOrigin, summarizeCatalog, utcDay, type CatalogSummary, type ShopifyProduct } from "./lib/storeSales";

// ── Store sales tracking ────────────────────────────────────────────────────
// Once a day we read each store's public Shopify catalog (/products.json) and
// save how many products changed since the last check, an estimated order and
// revenue range, and the products that changed ("recently selling").
// Tracked stores go first, then Shopify stores found by product discovery.
// Pure maths: convex/lib/storeSales.ts.

const MAX_PER_RUN = 150;
const PARALLEL = 8;
const MAX_PAGES = 4; // 250 products each
const MAX_FAILURES = 3; // stores that fail 3 checks in a row are skipped
const MAX_WINDOW_HOURS = 48;
const KEEP_DAYS = 90;
const HOUR = 3_600_000;

type CheckResult = { status: "ok"; updatedCount: number } | { status: "error"; error: string };

async function fetchCatalog(origin: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${origin}/products.json?limit=250&page=${page}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; AdSpyPro store tracker)" },
        signal: controller.signal,
      });
    } catch {
      throw new Error("The store didn't respond");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(res.status === 404 ? "No public Shopify catalog" : `The store answered ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error("No public Shopify catalog");
    }
    const products = (body as { products?: unknown })?.products;
    if (!Array.isArray(products)) throw new Error("No public Shopify catalog");
    all.push(...(products as ShopifyProduct[]));
    if (products.length < 250) break;
  }
  return all;
}

async function checkStore(ctx: ActionCtx, store: { _id: Id<"stores">; url: string }): Promise<CheckResult> {
  const origin = storeOrigin(store.url);
  if (!origin) {
    await ctx.runMutation(internal.storeSales.recordFailure, { storeId: store._id, error: "Store link isn't a website" });
    return { status: "error", error: "Store link isn't a website" };
  }
  let products: ShopifyProduct[];
  try {
    products = await fetchCatalog(origin);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't read the store";
    await ctx.runMutation(internal.storeSales.recordFailure, { storeId: store._id, error });
    return { status: "error", error };
  }
  const now = Date.now();
  const previous = await ctx.runQuery(internal.storeSales.previousCheck, { storeId: store._id, day: utcDay(now) });
  const since = Math.max(previous ? Date.parse(previous) : now - 24 * HOUR, now - MAX_WINDOW_HOURS * HOUR);
  const summary = summarizeCatalog(products, origin, since);
  await ctx.runMutation(internal.storeSales.saveSnapshot, {
    storeId: store._id,
    takenAt: new Date(now).toISOString(),
    windowHours: Math.round(((now - since) / HOUR) * 10) / 10,
    summary,
  });
  return { status: "ok", updatedCount: summary.updatedCount };
}

// ── Daily run ───────────────────────────────────────────────────────────────

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - 20 * HOUR).toISOString();
    const due = (s: Doc<"stores"> | null): s is Doc<"stores"> =>
      !!s && (!s.salesCheck || (s.salesCheck.failures < MAX_FAILURES && s.salesCheck.at < cutoff));
    const picked = new Map<Id<"stores">, { _id: Id<"stores">; url: string }>();
    const tracked = await ctx.db.query("trackedStores").order("desc").take(2000);
    for (const id of new Set(tracked.map((t) => t.storeId))) {
      if (picked.size >= MAX_PER_RUN) break;
      const s = await ctx.db.get("stores", id);
      if (due(s)) picked.set(s._id, { _id: s._id, url: s.url });
    }
    const recent = await ctx.db.query("stores").withIndex("by_spotted").order("desc").take(500);
    for (const s of recent) {
      if (picked.size >= MAX_PER_RUN) break;
      if (s.platform === "Shopify" && due(s)) picked.set(s._id, { _id: s._id, url: s.url });
    }
    return [...picked.values()];
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.runQuery(internal.storeSales.candidates, {});
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < stores.length; i += PARALLEL) {
      const results = await Promise.all(stores.slice(i, i + PARALLEL).map((s) => checkStore(ctx, s)));
      for (const r of results) {
        if (r.status === "ok") ok++;
        else failed++;
      }
    }
    console.log(`Store sales tracking: ${ok} checked, ${failed} failed, ${stores.length} due`);
    return { checked: ok, failed };
  },
});

export const checkOne = internalAction({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args): Promise<CheckResult | null> => {
    const store = await ctx.runQuery(internal.storeSales.storeForCheck, { storeId: args.storeId });
    return store ? await checkStore(ctx, store) : null;
  },
});

// "Check now" in the store popup: signed-in users, at most once an hour per store.
export const checkNow = action({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args): Promise<CheckResult | { status: "recent" }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to check a store." });
    const store = await ctx.runQuery(internal.storeSales.storeForCheck, { storeId: args.storeId });
    if (!store) throw new ConvexError({ code: "NOT_FOUND", message: "Store not found" });
    if (store.lastCheckAt && Date.now() - Date.parse(store.lastCheckAt) < HOUR) return { status: "recent" };
    return await checkStore(ctx, store);
  },
});

// ── Internal reads and writes ───────────────────────────────────────────────

export const storeForCheck = internalQuery({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get("stores", args.storeId);
    return s ? { _id: s._id, url: s.url, lastCheckAt: s.salesCheck?.at } : null;
  },
});

// When the last check before today ran (the start of today's window).
export const previousCheck = internalQuery({
  args: { storeId: v.id("stores"), day: v.string() },
  handler: async (ctx, args) => {
    const prev = await ctx.db
      .query("storeSalesSnapshots")
      .withIndex("by_store_day", (q) => q.eq("storeId", args.storeId).lt("day", args.day))
      .order("desc")
      .first();
    return prev?.takenAt ?? null;
  },
});

const summaryValidator = v.object({
  productCount: v.number(),
  updatedCount: v.number(),
  newCount: v.number(),
  avgPrice: v.number(),
  estOrdersLow: v.number(),
  estOrdersHigh: v.number(),
  estRevenueLow: v.number(),
  estRevenueHigh: v.number(),
  topProducts: v.array(v.object({ title: v.string(), url: v.string(), imageUrl: v.string(), price: v.number(), updatedAt: v.string() })),
});

export const saveSnapshot = internalMutation({
  args: { storeId: v.id("stores"), takenAt: v.string(), windowHours: v.number(), summary: summaryValidator },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) return;
    const day = args.takenAt.slice(0, 10);
    const row = { storeId: args.storeId, day, takenAt: args.takenAt, windowHours: args.windowHours, ...(args.summary as CatalogSummary) };
    const existing = await ctx.db
      .query("storeSalesSnapshots")
      .withIndex("by_store_day", (q) => q.eq("storeId", args.storeId).eq("day", day))
      .unique();
    if (existing) await ctx.db.replace("storeSalesSnapshots", existing._id, row);
    else await ctx.db.insert("storeSalesSnapshots", row);

    // Drop days older than KEEP_DAYS.
    const cutoff = utcDay(Date.parse(args.takenAt) - KEEP_DAYS * 24 * HOUR);
    const old = await ctx.db
      .query("storeSalesSnapshots")
      .withIndex("by_store_day", (q) => q.eq("storeId", args.storeId).lt("day", cutoff))
      .take(20);
    for (const o of old) await ctx.db.delete("storeSalesSnapshots", o._id);

    // After 3 days of data, the store's revenue range comes from tracking.
    const recent = await ctx.db
      .query("storeSalesSnapshots")
      .withIndex("by_store_day", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(30);
    // Alert the store's trackers on the first check of the day only.
    if (!existing) {
      const alert = storeAlert(store.name, row, recent.slice(1, 8));
      if (alert) {
        await ctx.scheduler.runAfter(0, internal.notifications.notifyTrackersOfStoreUpdate, {
          storeId: args.storeId,
          ...alert,
          link: `/dashboard/stores?store=${args.storeId}`,
        });
      }
    }

    const patch: Partial<Doc<"stores">> = { salesCheck: { at: args.takenAt, ok: true, failures: 0 } };
    if (recent.length >= 3) {
      // Per 24 hours, so a longer gap between checks doesn't inflate it.
      const perDay = recent.map((r) => {
        const f = 24 / Math.max(1, r.windowHours);
        return { estRevenueLow: r.estRevenueLow * f, estRevenueHigh: r.estRevenueHigh * f };
      });
      const range = monthlyRevenueRange(perDay);
      if (range) patch.estimatedRevenueRange = range;
    }
    await ctx.db.patch("stores", args.storeId, patch);
  },
});

export const recordFailure = internalMutation({
  args: { storeId: v.id("stores"), error: v.string() },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) return;
    await ctx.db.patch("stores", args.storeId, {
      salesCheck: { at: new Date().toISOString(), ok: false, error: args.error, failures: (store.salesCheck?.failures ?? 0) + 1 },
    });
  },
});

// ── Store popup ─────────────────────────────────────────────────────────────

export const history = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) return null;
    const days = await ctx.db
      .query("storeSalesSnapshots")
      .withIndex("by_store_day", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(KEEP_DAYS);
    return { check: store.salesCheck ?? null, days: days.reverse() };
  },
});
