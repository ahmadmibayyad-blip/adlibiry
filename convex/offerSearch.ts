import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import { requireAdmin } from "./admin/helpers";
import { runCostCap } from "./apify";
import { PICTURE_ACTOR, fromPictureSearch, pictureLimit, type PictureMatch } from "./lib/aliexpress";
import { budgetLeft } from "./lib/fusion";
import { toUsd } from "./lib/priceParse";
import { inspectHtml } from "./lib/storeInspect";
import {
  adLibrarySearchUrl,
  adShowsOffer,
  catalogueSignals,
  DROPSHIP_APPS,
  sourcingAppsIn,
  dailyOfferPhrases,
  storeType,
  groupByStore,
  OFFER_COUNTRIES,
  OFFER_IDS,
  productHandle,
  readShopifyProduct,
  readShopMeta,
  researchAdsPerCountry,
  researchUrls,
  searchKey,
  searchPhrases,
  shortError,
  storeHost,
  toSearchAd,
  type FoundProduct,
  type FoundStore,
  type OfferId,
} from "./lib/offerSearch";

// Offer Search (/dashboard/offer-search): the stores advertising an offer in a country right now. The
// offer's phrases (lib/offerSearch.ts) are searched in Meta's public Ad Library through Apify, like the
// daily imports (apify.ts: the run's ads also land in Ad Spy). When the run finishes, its ads are grouped
// by store, with offer chips and whether the store runs on Shopify. The same search within 6 hours is
// answered from the last one; runs count against the Apify daily budget (APIFY_DAILY_BUDGET_USD).
// Each store gets its EU reach (EU/UK searches: Apify reads the ads' details at no extra cost), its
// currency from /meta.json (which also says it's Shopify) and the products its ads link to.
//
// Offer research (Admin → Offer research, importRuns job "offerResearch"): every day, every offer's main
// phrase in every Offer Search country, OFFER_RESEARCH_ADS ads in all (default 1,000, ~$0.75), saved as
// offerSearches rows without a user and with `daily` set to the day.

export const FREE_SEARCHES_PER_DAY = 3;
export const PRO_SEARCHES_PER_DAY = 30;
export const TRIAL_SEARCHES_PER_DAY = 5; // each search is a paid Apify run
const searchLimit = (user: Doc<"users">) =>
  byTier(user, { admin: 1000, paid: PRO_SEARCHES_PER_DAY, trial: TRIAL_SEARCHES_PER_DAY, free: FREE_SEARCHES_PER_DAY });
const MAX_ADS = 150;
// Apify's account limit (its monthly usage limit, or no credit left): it won't pass in a minute.
const APIFY_ACCOUNT_LIMIT = /hard limit|usage limit|platform-feature-disabled|insufficient|credit/i;
const APIFY_LIMIT_MESSAGE =
  "The Apify account has reached its monthly usage limit (or has no credit left). Raise it at console.apify.com → Settings → Usage & billing.";
/** A run's error as Admin shows it: the account-limit sentence, or the message without Convex's prefix and stack. */
const adminError = (error: string) => (APIFY_ACCOUNT_LIMIT.test(error) ? APIFY_LIMIT_MESSAGE : shortError(error));
const CACHE_MS = 6 * 3_600_000;
// The Ad Library scraper charges $0.00075 per ad: one search costs at most about $0.18.
const capUsd = () => Math.round((MAX_ADS * 0.00075 * 1.5 + 0.01) * 100) / 100;
const dailyBudget = () => {
  const n = Number(process.env.APIFY_DAILY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 10;
};

async function signedInUser(ctx: { db: import("./_generated/server").QueryCtx["db"] }, token: string): Promise<Doc<"users"> | null> {
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", token)).unique();
}

/** The user, their searches today and limit, and a recent search with the same key. */
export const before = internalQuery({
  args: { token: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const user = await signedInUser(ctx, args.token);
    if (!user) return null;
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const limit = searchLimit(user);
    const today = (await ctx.db.query("offerSearches").withIndex("by_user", (q) => q.eq("userId", user._id).gt("createdAt", since)).take(limit + 50)).filter(
      (s) => !s.cachedFrom,
    );
    const fresh = new Date(Date.now() - CACHE_MS).toISOString();
    const recentSame = await ctx.db.query("offerSearches").withIndex("by_key", (q) => q.eq("key", args.key).gt("createdAt", fresh)).order("desc").take(5);
    const cached = recentSame.find((s) => s.status !== "failed") ?? null;
    return { userId: user._id, used: today.length, limit, cached };
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    key: v.string(),
    country: v.string(),
    offer: v.optional(v.string()),
    phrases: v.array(v.string()),
    runToken: v.optional(v.string()),
    cachedFrom: v.optional(v.id("offerSearches")),
  },
  handler: async (ctx, args): Promise<Id<"offerSearches">> => {
    const from = args.cachedFrom ? await ctx.db.get("offerSearches", args.cachedFrom) : null;
    return ctx.db.insert("offerSearches", {
      ...args,
      status: from?.status ?? "running",
      createdAt: new Date().toISOString(),
      ...(from?.stores ? { stores: from.stores, adsFound: from.adsFound, finishedAt: from.finishedAt } : {}),
      ...(from?.runToken ? { runToken: from.runToken } : {}),
    });
  },
});

/** Starts a search, or answers from the same one made in the last 6 hours. */
export const start = action({
  args: { offer: v.optional(v.string()), country: v.string(), extra: v.optional(v.string()), custom: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ id: Id<"offerSearches">; cached: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const country = args.country.toUpperCase();
    if (!OFFER_COUNTRIES[country]) throw new ConvexError({ code: "BAD_COUNTRY", message: "Pick one of the listed countries." });
    const offer = OFFER_IDS.includes(args.offer as OfferId) ? (args.offer as OfferId) : undefined;
    if (!offer && !args.custom?.trim()) throw new ConvexError({ code: "NO_OFFER", message: "Pick an offer or type what to search for." });
    const phrases = searchPhrases({ offer, country, extra: args.extra, custom: args.custom });
    const key = searchKey(country, phrases);

    const b = await ctx.runQuery(internal.offerSearch.before, { token: stableToken(identity), key });
    if (!b) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (b.cached) {
      const id = await ctx.runMutation(internal.offerSearch.create, { userId: b.userId, key, country, ...(offer ? { offer } : {}), phrases, cachedFrom: b.cached._id });
      return { id, cached: true };
    }
    if (b.used >= b.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message:
          b.limit === FREE_SEARCHES_PER_DAY
            ? `Free accounts get ${FREE_SEARCHES_PER_DAY} offer searches a day. Upgrade to Pro for ${PRO_SEARCHES_PER_DAY}.`
            : b.limit === TRIAL_SEARCHES_PER_DAY
              ? `The free trial includes ${TRIAL_SEARCHES_PER_DAY} offer searches a day. Subscribe to Pro for ${PRO_SEARCHES_PER_DAY}.`
              : `That's ${b.limit} offer searches today. More tomorrow.`,
      });
    }
    if (!process.env.APIFY_TOKEN) throw new ConvexError({ code: "NOT_SET_UP", message: "Offer Search isn't switched on yet (APIFY_TOKEN)." });
    const day = new Date().toISOString().slice(0, 10);
    const spent: number = await ctx.runQuery(internal.fusion.spentOn, { day });
    if (budgetLeft(spent, dailyBudget()) < capUsd()) {
      throw new ConvexError({ code: "BUDGET", message: "Offer Search has reached today's search budget. Please try again tomorrow." });
    }

    const runToken = crypto.randomUUID().replace(/-/g, "");
    const id = await ctx.runMutation(internal.offerSearch.create, { userId: b.userId, key, country, ...(offer ? { offer } : {}), phrases, runToken });
    try {
      await ctx.runAction(internal.apify.startTrackedRun, {
        token: runToken,
        country,
        keyword: phrases.join(" | ").slice(0, 200),
        niche: "General",
        maxAds: MAX_ADS,
        urls: phrases.map((p) => adLibrarySearchUrl(country, p)),
        trigger: "offer",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const accountLimit = APIFY_ACCOUNT_LIMIT.test(msg);
      await ctx.runMutation(internal.offerSearch.finished, {
        runToken,
        error: accountLimit ? "Offer Search has used this month's search credit. It's back once the account is topped up." : "The search couldn't start. Please try again in a minute.",
      });
      console.error("Offer search: Apify run didn't start", msg.slice(0, 300));
      return { id, cached: false };
    }
    // If Apify's webhook never comes, look at the run ourselves.
    await ctx.scheduler.runAfter(8 * 60_000, internal.offerSearch.checkRun, { runToken, attempt: 1 });
    return { id, cached: false };
  },
});

/** Saves a finished search on every row that waits for it (the user's, and any answered from it while it ran). */
/** The searches still waiting on an Apify run, with what each searched for. */
export const runningForToken = internalQuery({
  args: { runToken: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("offerSearches").withIndex("by_token", (q) => q.eq("runToken", args.runToken)).take(100);
    return rows.filter((r) => r.status === "running").map((r) => ({ _id: r._id, offer: r.offer, phrases: r.phrases, daily: !!r.daily }));
  },
});

/** One search's stores, once its run is read. */
export const finishedSearch = internalMutation({
  args: { id: v.id("offerSearches"), stores: v.any(), adsFound: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("offerSearches", args.id);
    if (row?.status !== "running") return;
    await ctx.db.patch("offerSearches", args.id, { status: "done", stores: args.stores, adsFound: args.adsFound, finishedAt: new Date().toISOString() });
  },
});

type Sourcing = NonNullable<FoundProduct["sourcing"]>;
const SOURCED_PER_SEARCH = 15;

/** Up to 15 stores' main product photo through AliExpress's picture search (5 at a time, each counted in the day's
 * picture limit): the cheapest match, with the store's price in USD over it as the markup. Never throws. */
async function sourceHeroProducts(ctx: ActionCtx, stores: FoundStore[]): Promise<Map<string, Sourcing>> {
  const out = new Map<string, Sourcing>();
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return out;
  const picks = stores.filter((s) => s.products?.[0]?.image && s.products[0].price).slice(0, SOURCED_PER_SEARCH);
  if (!picks.length) return out;
  const rates: Record<string, number> = await ctx.runQuery(internal.currency.allRates, {});
  let open = true;
  for (let i = 0; i < picks.length && open; i += 5) {
    await Promise.all(
      picks.slice(i, i + 5).map(async (s) => {
        if (!open || !(await ctx.runMutation(internal.aliexpressImage.claimForSearch, { limit: pictureLimit() }))) {
          open = false;
          return;
        }
        const p = s.products![0];
        const usd = toUsd({ amount: p.price!, currency: s.currency ?? "USD" }, rates);
        try {
          const q = new URLSearchParams({ token, timeout: "60", maxTotalChargeUsd: "0.02" });
          const res = await fetch(`https://api.apify.com/v2/acts/${PICTURE_ACTOR}/run-sync-get-dataset-items?${q}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: p.image, destination: "aliexpress", language: "en", currency: "USD" }),
            signal: AbortSignal.timeout(75_000),
          });
          if (!res.ok) return;
          const found = fromPictureSearch(await res.json().catch(() => null), { price: usd, title: p.title });
          const best = found.reduce<PictureMatch | undefined>((m, x) => (!m || x.price < m.price ? x : m), undefined);
          if (best && usd) out.set(s.host, { price: best.price, url: best.url, title: best.title, markup: Math.round((usd / best.price) * 10) / 10 });
        } catch {
          // No match for this one.
        }
      }),
    );
  }
  return out;
}

/** The store with its main product's AliExpress match, typed again so the match counts. */
function withSourcing(s: FoundStore, match: Sourcing | undefined): FoundStore {
  if (!match || !s.products?.length) return s;
  const next: FoundStore = { ...s, products: [{ ...s.products[0], sourcing: match }, ...s.products.slice(1)] };
  return { ...next, dropship: storeType(next) };
}

const dropUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T;

export const finished = internalMutation({
  args: { runToken: v.string(), stores: v.optional(v.any()), adsFound: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("offerSearches").withIndex("by_token", (q) => q.eq("runToken", args.runToken)).take(100);
    const finishedAt = new Date().toISOString();
    for (const row of rows) {
      if (row.status !== "running") continue;
      await ctx.db.patch(
        "offerSearches",
        row._id,
        args.error ? { status: "failed", error: args.error.slice(0, 300), finishedAt } : { status: "done", stores: args.stores, adsFound: args.adsFound ?? 0, finishedAt },
      );
    }
  },
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const STORES_KEPT = 40;
const PRODUCTS_PER_STORE = 2;

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    return res.ok ? await res.json().catch(() => null) : null;
  } catch {
    return null;
  }
}

/** A Shopify store's /products.json (up to 250), or null when it doesn't answer. */
async function productList(host: string): Promise<unknown[] | null> {
  const body = (await getJson(`https://${host}/products.json?limit=250`)) as { products?: unknown } | null;
  return Array.isArray(body?.products) ? body.products : null;
}

/** The dropshipping apps on a store's home page (Store Inspector's app list plus supplier-ordering apps). */
async function dropshipApps(host: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${host}/`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return [];
    const html = (await res.text()).slice(0, 2_000_000);
    const known = inspectHtml(html).apps.map((a) => a.name).filter((n) => DROPSHIP_APPS.has(n));
    return [...new Set([...known, ...sourcingAppsIn(html)])];
  } catch {
    return [];
  }
}

/** Shopify stores answer /meta.json (currency, country), /products.json and /products/<handle>.json; others are left as they are. */
async function withShopData(s: FoundStore): Promise<FoundStore> {
  const meta = readShopMeta(await getJson(`https://${s.host}/meta.json`));
  if (!meta) return { ...s, shopify: false };
  const [list, apps] = await Promise.all([productList(s.host), dropshipApps(s.host)]);
  const count = list?.length;
  const handles = s.productPaths.map(productHandle).filter((h): h is string => !!h).slice(0, PRODUCTS_PER_STORE);
  const products = (
    await Promise.all(handles.map(async (h) => readShopifyProduct(await getJson(`https://${s.host}/products/${encodeURIComponent(h)}.json`), s.host, h)))
  ).filter((p): p is FoundProduct => !!p);
  return {
    ...s,
    shopify: true,
    ...(meta.currency ? { currency: meta.currency } : {}),
    ...(meta.country ? { storeCountry: meta.country } : {}),
    ...(products.length ? { products } : {}),
    ...(count !== undefined ? { productCount: count } : {}),
    ...(meta.products !== undefined ? { catalogue: meta.products } : count ? { catalogue: count } : {}),
    ...catalogueSignals(list),
    ...(apps.length ? { apps } : {}),
  };
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Called by apify.handleWebhook for an "offer" run: groups the run's ads by store and saves them. */
export const finish = internalAction({
  args: { runToken: v.string(), datasetId: v.string() },
  handler: async (ctx, args) => {
    const token = process.env.APIFY_TOKEN;
    if (!token) return;
    const res = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(args.datasetId)}/items?clean=true&format=json&limit=500&token=${token}`).catch(() => null);
    if (!res?.ok) {
      await ctx.runMutation(internal.offerSearch.finished, { runToken: args.runToken, error: "Meta's results couldn't be read. Please try again." });
      return;
    }
    const items = ((await res.json().catch(() => [])) as unknown[]) ?? [];
    const ads = items.map(toSearchAd).filter((a): a is NonNullable<typeof a> => !!a);
    if (!ads.length) {
      const actorError = items.map((it) => (it as { error?: unknown })?.error).find((e) => typeof e === "string");
      if (actorError) console.warn("Offer search: Apify actor error", actorError);
      await ctx.runMutation(
        internal.offerSearch.finished,
        actorError ? { runToken: args.runToken, error: "The search service couldn't search Meta right now. Please try again later." } : { runToken: args.runToken, stores: [], adsFound: 0 },
      );
      return;
    }
    // Each search on this run keeps only the ads showing its offer (a daily research run serves every offer);
    // a store's shop data is read once however many searches show it.
    const searches = await ctx.runQuery(internal.offerSearch.runningForToken, { runToken: args.runToken });
    const perSearch = searches.map((row) => {
      // The daily research searches every offer at once; a user's search one offer, or their own words.
      const offers: (OfferId | null)[] = row.daily ? OFFER_IDS : [(row.offer as OfferId | undefined) ?? null];
      const kept = ads.filter((a) => offers.some((o) => adShowsOffer(a, o, row.phrases)));
      return { id: row._id, adsFound: kept.length, stores: groupByStore(kept).slice(0, STORES_KEPT), typed: undefined as FoundStore[] | undefined };
    });
    const byHost = new Map<string, FoundStore>();
    for (const x of perSearch) for (const st of x.stores) if (!byHost.has(st.host)) byHost.set(st.host, st);
    const shop = new Map((await inBatches([...byHost.values()], 10, withShopData)).map((st) => [st.host, st]));
    for (const x of perSearch) {
      const stores = x.stores.map((st) => {
        const d = shop.get(st.host);
        const merged: FoundStore = d
          ? {
              ...st,
              shopify: d.shopify,
              currency: d.currency,
              storeCountry: d.storeCountry,
              products: d.products,
              productCount: d.productCount,
              catalogue: d.catalogue,
              productTypes: d.productTypes,
              onSaleShare: d.onSaleShare,
              tmShare: d.tmShare,
              defaultVendor: d.defaultVendor,
              apps: d.apps,
            }
          : st;
        return { ...dropUndefined(merged), dropship: storeType(merged) };
      });
      x.typed = stores;
    }
    // Users' searches: the hero product of up to 15 likely dropshippers matched on AliExpress (not the daily research).
    const userSearch = searches.some((r) => !r.daily);
    const candidates = new Map<string, FoundStore>();
    for (const x of perSearch) for (const st of x.typed ?? []) if (st.dropship?.likely && !candidates.has(st.host)) candidates.set(st.host, st);
    const matches = userSearch ? await sourceHeroProducts(ctx, [...candidates.values()].sort((a, b) => b.ads - a.ads)) : new Map<string, Sourcing>();
    for (const x of perSearch) {
      const stores = (x.typed ?? []).map((st) => withSourcing(st, matches.get(st.host)));
      await ctx.runMutation(internal.offerSearch.finishedSearch, { id: x.id, stores, adsFound: x.adsFound });
    }
  },
});

export const runByToken = internalQuery({
  args: { runToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query("apifyRuns").withIndex("by_token", (q) => q.eq("token", args.runToken)).unique();
    const search = await ctx.db.query("offerSearches").withIndex("by_token", (q) => q.eq("runToken", args.runToken)).first();
    return { runId: run?.runId, running: search?.status === "running" };
  },
});

/** When the webhook didn't come: asks Apify how the run went, and finishes the search from its dataset. */
export const checkRun = internalAction({
  args: { runToken: v.string(), attempt: v.number() },
  handler: async (ctx, args) => {
    const r = await ctx.runQuery(internal.offerSearch.runByToken, { runToken: args.runToken });
    if (!r.running) return;
    const token = process.env.APIFY_TOKEN;
    if (!token || !r.runId) {
      await ctx.runMutation(internal.offerSearch.finished, { runToken: args.runToken, error: "The search didn't finish. Please try again." });
      return;
    }
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(r.runId)}?token=${token}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => ({}))) as { data?: { status?: string; defaultDatasetId?: string } }).data : undefined;
    if (data?.status === "SUCCEEDED" && data.defaultDatasetId) {
      await ctx.runAction(internal.offerSearch.finish, { runToken: args.runToken, datasetId: data.defaultDatasetId });
    } else if (data?.status && /FAILED|ABORTED|TIMED-OUT/.test(data.status)) {
      await ctx.runMutation(internal.offerSearch.finished, { runToken: args.runToken, error: "The search didn't finish. Please try again." });
    } else if (args.attempt < 3) {
      await ctx.scheduler.runAfter(5 * 60_000, internal.offerSearch.checkRun, { runToken: args.runToken, attempt: args.attempt + 1 });
    } else {
      await ctx.runMutation(internal.offerSearch.finished, { runToken: args.runToken, error: "The search took too long. Please try again." });
    }
  },
});

/** One search, for the page (results are public ads, so any signed-in user may open a shared one). */
export const get = query({
  args: { id: v.id("offerSearches") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const s = await ctx.db.get("offerSearches", args.id);
    if (!s) return null;
    return { _id: s._id, country: s.country, offer: s.offer, phrases: s.phrases, status: s.status, createdAt: s.createdAt, finishedAt: s.finishedAt, error: s.error, adsFound: s.adsFound, stores: (s.stores ?? []) as FoundStore[] };
  },
});

/** The user's last searches, and today's count against the limit. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await signedInUser(ctx, stableToken(identity));
    if (!user) return null;
    const rows = await ctx.db.query("offerSearches").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(12);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const limit = searchLimit(user);
    return {
      used: rows.filter((r) => r.createdAt > since && !r.cachedFrom).length,
      limit,
      searches: rows.map((r) => ({ _id: r._id, country: r.country, offer: r.offer, phrases: r.phrases, status: r.status, createdAt: r.createdAt, stores: (r.stores as FoundStore[] | undefined)?.length ?? 0 })),
    };
  },
});

// ── Offer research (Admin → Offer research) ───────────────────────────────────

/** OFFER_RESEARCH_ADS: ads a day across all countries (default 1,000; "off" stops it). */
function researchTotal(): number {
  const raw = process.env.OFFER_RESEARCH_ADS?.trim();
  if (raw?.toLowerCase() === "off") return 0;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.min(5000, Math.round(n)) : 1000;
}

export const createDaily = internalMutation({
  args: { day: v.string(), country: v.string(), phrases: v.array(v.string()), runToken: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("offerSearches", {
      key: searchKey(args.country, args.phrases),
      country: args.country,
      phrases: args.phrases,
      status: "running",
      runToken: args.runToken,
      createdAt: new Date().toISOString(),
      daily: args.day,
    });
  },
});

/** Daily (importRuns job "offerResearch"): one Apify run per country with every offer's main phrase. */
export const dailyResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ started: number; ads: number; errors: string[] } | { notConfigured: string }> => {
    if (!process.env.APIFY_TOKEN) return { notConfigured: "APIFY_TOKEN isn't set" };
    const total = researchTotal();
    if (!total) return { notConfigured: "OFFER_RESEARCH_ADS is off" };
    const countries = Object.keys(OFFER_COUNTRIES);
    const perCountry = researchAdsPerCountry(total, countries.length);
    const day = new Date().toISOString().slice(0, 10);
    const out = { started: 0, ads: 0, errors: [] as string[] };
    for (const country of countries) {
      const spent: number = await ctx.runQuery(internal.fusion.spentOn, { day });
      if (budgetLeft(spent, dailyBudget()) < runCostCap(perCountry)) {
        out.errors.push(`${country} and later: today's Apify budget is used up (APIFY_DAILY_BUDGET_USD)`);
        break;
      }
      const phrases = dailyOfferPhrases(country).map((p) => p.phrase);
      const runToken = crypto.randomUUID().replace(/-/g, "");
      await ctx.runMutation(internal.offerSearch.createDaily, { day, country, phrases, runToken });
      try {
        await ctx.runAction(internal.apify.startTrackedRun, {
          token: runToken,
          country,
          keyword: "Offer research",
          niche: "General",
          maxAds: perCountry,
          urls: researchUrls(country),
          trigger: "offer",
        });
        await ctx.scheduler.runAfter(8 * 60_000, internal.offerSearch.checkRun, { runToken, attempt: 1 });
        out.started++;
        out.ads += perCountry;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // The Apify account's monthly limit or credit stops every country alike: say it once and stop.
        if (APIFY_ACCOUNT_LIMIT.test(msg)) {
          await ctx.runMutation(internal.offerSearch.finished, { runToken, error: APIFY_LIMIT_MESSAGE });
          out.errors.push(APIFY_LIMIT_MESSAGE);
          break;
        }
        await ctx.runMutation(internal.offerSearch.finished, { runToken, error: shortError(msg) });
        out.errors.push(`${country}: ${shortError(msg)}`);
      }
    }
    return out;
  },
});

/** Admin → Offer research: a day's results per country (the newest run of each), and the last days to pick from. */
export const research = query({
  args: { day: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const days: string[] = [];
    for (let i = 0; i < 14; i++) {
      const before = days[days.length - 1];
      const row = await ctx.db
        .query("offerSearches")
        .withIndex("by_daily", (q) => (before ? q.gt("daily", "").lt("daily", before) : q.gt("daily", "")))
        .order("desc")
        .first();
      if (!row?.daily) break;
      days.push(row.daily);
    }
    const day = args.day && days.includes(args.day) ? args.day : days[0];
    if (!day) return { days, day: null, countries: [] };
    const rows = await ctx.db.query("offerSearches").withIndex("by_daily", (q) => q.eq("daily", day)).take(100);
    const newest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!newest.has(r.country) || r.createdAt > newest.get(r.country)!.createdAt) newest.set(r.country, r);
    const countries = [...newest.values()]
      .sort((a, b) => a.country.localeCompare(b.country))
      .map((r) => ({
        country: r.country,
        status: r.status,
        ...(r.error ? { error: adminError(r.error) } : {}),
        adsFound: r.adsFound ?? 0,
        stores: ((r.stores ?? []) as FoundStore[]).map((s) => ({ ...s, country: r.country })),
      }));
    return { days, day, countries };
  },
});

// ── Quick actions on a found store ────────────────────────────────────────────

/** Which of these stores AdSpy already lists (their ids, for Collection) and which the user tracks. */
export const storeStates = query({
  args: { hosts: v.array(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await signedInUser(ctx, stableToken(identity));
    const out: { host: string; storeId: Id<"stores">; tracked: boolean }[] = [];
    for (const host of args.hosts.slice(0, 60)) {
      const store = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", host)).first();
      if (!store) continue;
      const tracked = user
        ? !!(await ctx.db.query("trackedStores").withIndex("by_user_and_store", (q) => q.eq("userId", user._id).eq("storeId", store._id)).unique())
        : false;
      out.push({ host, storeId: store._id, tracked });
    }
    return out;
  },
});

/** The store's row in AdSpy (made from the search when it isn't listed yet), for Track and Collection. */
export const ensureStore = mutation({
  args: { host: v.string(), name: v.optional(v.string()), shopify: v.optional(v.boolean()), country: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"stores">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const host = storeHost(`https://${args.host.trim()}`);
    if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new ConvexError({ code: "BAD_REQUEST", message: "That isn't a store address." });
    const existing = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", host)).first();
    if (existing) return existing._id;
    return ctx.db.insert("stores", {
      name: (args.name?.trim() || host).slice(0, 80),
      url: `https://${host}`,
      host,
      logoUrl: "",
      niche: "Other",
      country: args.country && /^[A-Z]{2}$/.test(args.country) ? args.country : "",
      platform: args.shopify ? "Shopify" : "Unknown",
      estimatedRevenueRange: "Unknown",
      trafficRange: "Unknown",
      activeAdsCount: 0,
      bestSellers: [],
      isHighTraffic: false,
      spottedAt: new Date().toISOString(),
      source: "offerSearch",
    });
  },
});

/**
 * "Find on AliExpress": AliExpress's visual search on a product's photo (counted in PICTURE_LOOKUPS_PER_DAY).
 * The store's product name isn't used to drop accessories: it's in the store's language, the listings in English.
 */
export const aliexpressFor = action({
  args: { imageUrl: v.string() },
  handler: async (ctx, args): Promise<{ matches: PictureMatch[] } | { skipped: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) return { skipped: "Picture search isn't switched on yet (APIFY_TOKEN)." };
    if (!/^https:\/\//.test(args.imageUrl)) return { skipped: "This product has no photo to search with." };
    if (!(await ctx.runMutation(internal.aliexpressImage.claimDay, { limit: pictureLimit() }))) return { skipped: "Today's picture searches are used up. More tomorrow." };
    const failed = { skipped: "AliExpress's picture search didn't answer. Try again in a minute." };
    try {
      const q = new URLSearchParams({ token, timeout: "60", maxTotalChargeUsd: "0.02" });
      const res = await fetch(`https://api.apify.com/v2/acts/${PICTURE_ACTOR}/run-sync-get-dataset-items?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: args.imageUrl, destination: "aliexpress", language: "en", currency: "USD" }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!res.ok) return failed;
      return { matches: fromPictureSearch(await res.json().catch(() => null)) };
    } catch {
      return failed;
    }
  },
});
