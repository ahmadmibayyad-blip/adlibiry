import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { monthlyRevenueRange, storeAlert, storeOrigin, summarizeCatalog, utcDay, type CatalogSummary, type ShopifyProduct } from "./lib/storeSales";
import { BOT_NAME, MAX_CATALOG, catalogDiff, reviewCountFromHtml, reviewsPerWeek, robotsAllows, type CatalogEntry } from "./lib/politeFetch";
import { toUsdWith } from "./lib/currency";
import { factorFor, storeRevenueEstimate } from "./lib/revenueModel";
import { readCalibration } from "./revenueTruth";

const compactUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : `$${Math.round(n)}`);

// ── Store sales tracking ────────────────────────────────────────────────────
// Once a day we read each store's public Shopify catalog (/products.json) and
// save how many products changed since the last check, an estimated order and
// revenue range, and the products that changed ("recently selling").
// Tracked stores go first, then Shopify stores found by product discovery.
// Polite: robots.txt is respected (checked weekly), catalog pages are read one
// second apart, and prices are converted from the store's currency to USD.
// Pure maths: convex/lib/storeSales.ts, convex/lib/politeFetch.ts.

const MAX_PER_RUN = 150;
const PARALLEL = 8;
const MAX_PAGES = 4; // 250 products each
const MAX_FAILURES = 3; // stores that fail 3 checks in a row are skipped
const MAX_WINDOW_HOURS = 48;
const KEEP_DAYS = 90;
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const UA = `Mozilla/5.0 (compatible; ${BOT_NAME}; store tracker)`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, timeoutMs = 10_000): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, text: res.ok ? (await res.text()).slice(0, 500_000) : "" };
  } catch {
    return null;
  }
}

type CheckResult = { status: "ok"; updatedCount: number } | { status: "error"; error: string };

async function fetchCatalog(origin: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    // The 15-second limit covers reading the body too, not just the headers.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let body: unknown;
    try {
      let res: Response;
      if (page > 1) await pause(1000); // one catalog page a second
      try {
        res = await fetch(`${origin}/products.json?limit=250&page=${page}`, {
          headers: { Accept: "application/json", "User-Agent": UA },
          signal: controller.signal,
        });
      } catch {
        throw new Error("The store didn't respond");
      }
      if (!res.ok) throw new Error(res.status === 404 ? "No public Shopify catalog" : `The store answered ${res.status}`);
      try {
        body = await res.json();
      } catch {
        throw new Error(controller.signal.aborted ? "The store didn't respond" : "No public Shopify catalog");
      }
    } finally {
      clearTimeout(timer);
    }
    const products = (body as { products?: unknown })?.products;
    if (!Array.isArray(products)) throw new Error("No public Shopify catalog");
    all.push(...(products as ShopifyProduct[]));
    if (products.length < 250) break;
  }
  return all;
}

type StoreToCheck = { _id: Id<"stores">; url: string; polite?: Doc<"stores">["polite"]; reviewsAt?: string };

async function checkStore(ctx: ActionCtx, store: StoreToCheck): Promise<CheckResult> {
  const origin = storeOrigin(store.url);
  if (!origin) {
    await ctx.runMutation(internal.storeSales.recordFailure, { storeId: store._id, error: "Store link isn't a website" });
    return { status: "error", error: "Store link isn't a website" };
  }
  // Weekly: robots.txt (may we read the catalog?) and the store's currency.
  const now0 = Date.now();
  let polite = store.polite;
  let robotsTxt = "";
  const politeDue = !polite || now0 - Date.parse(polite.checkedAt) > WEEK;
  if (!polite || politeDue) {
    const robots = await fetchText(`${origin}/robots.txt`);
    robotsTxt = robots?.status === 200 ? robots.text : "";
    const cart = await fetchText(`${origin}/cart.js`);
    let currency: string | undefined;
    try {
      currency = cart?.text ? (JSON.parse(cart.text) as { currency?: string }).currency : undefined;
    } catch {
      currency = undefined;
    }
    polite = { checkedAt: new Date(now0).toISOString(), robotsAllowed: robotsAllows(robotsTxt, "/products.json"), currency: /^[A-Z]{3}$/.test(currency ?? "") ? currency : undefined };
  }
  if (!polite.robotsAllowed) {
    await ctx.runMutation(internal.storeSales.recordRobotsBlock, { storeId: store._id, polite });
    return { status: "error", error: "The store's robots.txt asks crawlers not to read its catalog" };
  }
  let products: ShopifyProduct[];
  try {
    products = await fetchCatalog(origin);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't read the store";
    await ctx.runMutation(internal.storeSales.recordFailure, { storeId: store._id, error });
    return { status: "error", error };
  }
  // Prices in USD, from the store's own currency.
  if (polite.currency && polite.currency !== "USD") {
    const rates = await ctx.runQuery(internal.currency.allRates, {});
    if (rates[polite.currency]) {
      products = products.map((p) => ({
        ...p,
        variants: (p.variants ?? []).map((v) => ({ ...v, price: toUsdWith(Number(v.price), polite!.currency, rates) })),
      }));
    }
  }
  const now = Date.now();
  const previous = await ctx.runQuery(internal.storeSales.previousCheck, { storeId: store._id, day: utcDay(now) });
  const since = Math.max(previous ? Date.parse(previous) : now - 24 * HOUR, now - MAX_WINDOW_HOURS * HOUR);
  const summary = summarizeCatalog(products, origin, since);
  const lowest = (p: ShopifyProduct) => Math.min(...(p.variants ?? []).map((v) => Number(v.price)).filter((n) => n > 0), Infinity);
  const catalog: CatalogEntry[] = products
    .filter((p) => p.handle)
    .slice(0, MAX_CATALOG)
    .map((p) => ({ h: p.handle!, p: Number.isFinite(lowest(p)) ? Math.round(lowest(p) * 100) / 100 : 0 }));
  // Weekly: review counts on the products that sold, for review velocity.
  let reviewsChecked = false;
  // Only in a run that just re-read robots.txt, so every page fetched is allowed.
  if (politeDue && (!store.reviewsAt || now - Date.parse(store.reviewsAt) > WEEK)) {
    reviewsChecked = true;
    for (const top of summary.topProducts.slice(0, 8)) {
      const path = new URL(top.url).pathname;
      if (!robotsAllows(robotsTxt, path)) continue;
      await pause(500);
      const page = await fetchText(top.url);
      const count = page?.text ? reviewCountFromHtml(page.text) : undefined;
      const entry = catalog.find((e) => path.endsWith(`/${e.h}`));
      if (entry && count !== undefined) entry.r = count;
    }
  }
  await ctx.runMutation(internal.storeSales.saveSnapshot, {
    storeId: store._id,
    takenAt: new Date(now).toISOString(),
    windowHours: Math.round(((now - since) / HOUR) * 10) / 10,
    summary,
    polite,
    catalog,
    reviewsChecked,
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

// Each store is checked in its own scheduled action (PARALLEL at a time, 30 s
// apart). Checking them all in one action could take ~19 minutes, past the
// 10-minute action limit, and stop partway with no record of where.
export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const stores = await ctx.runQuery(internal.storeSales.candidates, {});
    for (const [i, store] of stores.entries()) {
      await ctx.scheduler.runAfter(Math.floor(i / PARALLEL) * 30_000, internal.storeSales.checkOne, { storeId: store._id });
    }
    return { scheduled: stores.length };
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
    return s ? { _id: s._id, url: s.url, lastCheckAt: s.salesCheck?.at, polite: s.polite, reviewsAt: s.reviews?.checkedAt } : null;
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

const politeValidator = v.object({ checkedAt: v.string(), robotsAllowed: v.boolean(), currency: v.optional(v.string()) });
const catalogValidator = v.array(v.object({ h: v.string(), p: v.number(), r: v.optional(v.number()), f: v.optional(v.string()) }));

export const recordRobotsBlock = internalMutation({
  args: { storeId: v.id("stores"), polite: politeValidator },
  handler: async (ctx, args) => {
    // Skipped from now on (failures = MAX_FAILURES): the owner asked crawlers to stay out.
    await ctx.db.patch("stores", args.storeId, {
      polite: args.polite,
      salesCheck: { at: new Date().toISOString(), ok: false, error: "The store's robots.txt asks crawlers not to read its catalog", failures: MAX_FAILURES },
    });
  },
});

export const saveSnapshot = internalMutation({
  args: {
    storeId: v.id("stores"),
    takenAt: v.string(),
    windowHours: v.number(),
    summary: summaryValidator,
    polite: v.optional(politeValidator),
    catalog: v.optional(catalogValidator),
    reviewsChecked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) return;
    const day = args.takenAt.slice(0, 10);
    // Review counts not re-read this time carry over from the last catalog.
    const saved = await ctx.db.query("storeCatalogs").withIndex("by_store", (q) => q.eq("storeId", args.storeId)).unique();
    // First-seen days carry over; products new since the last check are first seen today.
    const before = new Map((saved?.entries ?? []).map((e) => [e.h, e]));
    const catalog = args.catalog?.map((e) => {
      const old = before.get(e.h);
      const r = e.r ?? old?.r;
      const f = old ? old.f : saved ? day : undefined;
      return { h: e.h, p: e.p, ...(r !== undefined ? { r } : {}), ...(f ? { f } : {}) };
    });
    const diff = catalog ? catalogDiff(saved?.entries, catalog) : undefined;
    if (catalog) {
      if (saved) await ctx.db.patch("storeCatalogs", saved._id, { entries: catalog });
      else await ctx.db.insert("storeCatalogs", { storeId: args.storeId, entries: catalog });
    }
    const row = {
      storeId: args.storeId,
      day,
      takenAt: args.takenAt,
      windowHours: args.windowHours,
      ...(args.summary as CatalogSummary),
      ...(args.polite?.currency ? { currency: args.polite.currency } : {}),
      ...(diff ? { diff } : {}),
    };
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
    if (!existing && diff && diff.priceChanges > 0) {
      await ctx.scheduler.runAfter(0, internal.notifications.notifyTrackersOfStoreUpdate, {
        storeId: args.storeId,
        title: `${store.name} changed ${diff.priceChanges} price${diff.priceChanges === 1 ? "" : "s"}`,
        body: diff.examples
          .filter((e) => e.change === "price")
          .slice(0, 2)
          .map((e) => `${e.handle.replace(/-/g, " ")}: $${e.from} → $${e.to}`)
          .join(" · "),
        link: `/dashboard/stores?store=${args.storeId}`,
      });
    }
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
    if (args.polite) patch.polite = args.polite;
    const origin = storeOrigin(store.url);
    if (origin) patch.host = new URL(origin).hostname.replace(/^www\./, "");
    if (args.reviewsChecked && catalog) {
      const weeks = store.reviews ? (Date.parse(args.takenAt) - Date.parse(store.reviews.checkedAt)) / WEEK : 0;
      patch.reviews = { checkedAt: args.takenAt, perWeek: reviewsPerWeek(saved?.entries, catalog, weeks) };
    }
    if (recent.length >= 3) {
      // Per 24 hours, so a longer gap between checks doesn't inflate it.
      const perDay = recent.map((r) => {
        const f = 24 / Math.max(1, r.windowHours);
        return { estRevenueLow: r.estRevenueLow * f, estRevenueHigh: r.estRevenueHigh * f };
      });
      // Middle of each day's 1–3 orders-per-change range, then catalog changes
      // and review velocity combined (lib/revenueModel.ts), calibrated.
      const daily = perDay.reduce((a, d) => a + Math.sqrt(Math.max(d.estRevenueLow, 0.01) * Math.max(d.estRevenueHigh, 0.01)), 0) / perDay.length;
      const est = storeRevenueEstimate({
        catalogDailyRevenue: daily,
        reviewsPerWeek: patch.reviews?.perWeek ?? store.reviews?.perWeek,
        avgPrice: row.avgPrice,
      });
      if (est) {
        const point = est.point * factorFor(await readCalibration(ctx), "store");
        patch.estimatedRevenueRange = `~${compactUsd(point)}/mo`;
        patch.revenueConfidence = est.confidence;
      } else {
        const range = monthlyRevenueRange(perDay);
        if (range) patch.estimatedRevenueRange = range;
      }
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

// The store's catalog (newest first, with first-seen day, reviews and an
// estimate of orders in the last 30 days from how often each product changed)
// and the ads that link to its domain.
export const catalog = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const store = await ctx.db.get("stores", args.storeId);
    if (!store) return null;
    const saved = await ctx.db.query("storeCatalogs").withIndex("by_store", (q) => q.eq("storeId", args.storeId)).unique();
    const days = await ctx.db.query("storeSalesSnapshots").withIndex("by_store_day", (q) => q.eq("storeId", args.storeId)).order("desc").take(30);
    const changes = new Map<string, number>();
    for (const d of days) for (const t of d.topProducts) {
      const handle = t.url.split("/products/")[1];
      if (handle) changes.set(handle, (changes.get(handle) ?? 0) + 1);
    }
    const entries = (saved?.entries ?? [])
      .map((e) => ({ handle: e.h, price: e.p, reviews: e.r, firstSeen: e.f, estOrders30d: changes.has(e.h) ? Math.round(changes.get(e.h)! * 1.7) : undefined }))
      .sort((a, b) => (b.estOrders30d ?? 0) - (a.estOrders30d ?? 0) || (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""))
      .slice(0, 100);
    const ads = store.host
      ? await ctx.db.query("ads").withIndex("by_landing_host", (q) => q.eq("landingHost", store.host)).order("desc").take(12)
      : [];
    return {
      origin: storeOrigin(store.url),
      entries,
      totalProducts: saved?.entries.length ?? 0,
      ads: ads.map((a) => ({ _id: a._id, headline: a.headline, creativeUrl: a.creativeUrl, platform: a.platform, firstSeenAt: a.firstSeenAt, daysRunning: a.daysRunning })),
    };
  },
});

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
