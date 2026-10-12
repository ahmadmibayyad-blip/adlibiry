import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan } from "./lib/billing";
import { budgetLeft } from "./lib/fusion";
import { adLibrarySearchUrl, groupByStore, OFFER_COUNTRIES, OFFER_IDS, searchKey, searchPhrases, toSearchAd, type FoundStore, type OfferId } from "./lib/offerSearch";

// Offer Search (/dashboard/offer-search): the stores advertising an offer in a country right now. The
// offer's phrases (lib/offerSearch.ts) are searched in Meta's public Ad Library through Apify, like the
// daily imports (apify.ts: the run's ads also land in Ad Spy). When the run finishes, its ads are grouped
// by store, with offer chips and whether the store runs on Shopify. The same search within 6 hours is
// answered from the last one; runs count against the Apify daily budget (APIFY_DAILY_BUDGET_USD).

export const FREE_SEARCHES_PER_DAY = 3;
export const PRO_SEARCHES_PER_DAY = 30;
const MAX_ADS = 150;
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
    const limit = user.role === "admin" ? 1000 : effectivePlan(user) === "none" ? FREE_SEARCHES_PER_DAY : PRO_SEARCHES_PER_DAY;
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
        message: b.limit === FREE_SEARCHES_PER_DAY ? `Free accounts get ${FREE_SEARCHES_PER_DAY} offer searches a day. Upgrade to Pro for ${PRO_SEARCHES_PER_DAY}.` : `That's ${b.limit} offer searches today. More tomorrow.`,
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
      await ctx.runMutation(internal.offerSearch.finished, { runToken, error: "The search couldn't start. Please try again in a minute." });
      console.error("Offer search: Apify run didn't start", e);
      return { id, cached: false };
    }
    // If Apify's webhook never comes, look at the run ourselves.
    await ctx.scheduler.runAfter(8 * 60_000, internal.offerSearch.checkRun, { runToken, attempt: 1 });
    return { id, cached: false };
  },
});

/** Saves a finished search on every row that waits for it (the user's, and any answered from it while it ran). */
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

/** Shopify stores answer /products.json with their products. */
async function isShopify(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/products.json?limit=1`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { products?: unknown } | null;
    return Array.isArray(body?.products);
  } catch {
    return false;
  }
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
    const stores: FoundStore[] = groupByStore(ads).slice(0, 40);
    const checks = await Promise.all(stores.slice(0, 20).map((s) => isShopify(s.host)));
    checks.forEach((ok, i) => (stores[i].shopify = ok));
    await ctx.runMutation(internal.offerSearch.finished, { runToken: args.runToken, stores, adsFound: ads.length });
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
    const limit = user.role === "admin" ? 1000 : effectivePlan(user) === "none" ? FREE_SEARCHES_PER_DAY : PRO_SEARCHES_PER_DAY;
    return {
      used: rows.filter((r) => r.createdAt > since && !r.cachedFrom).length,
      limit,
      searches: rows.map((r) => ({ _id: r._id, country: r.country, offer: r.offer, phrases: r.phrases, status: r.status, createdAt: r.createdAt, stores: (r.stores as FoundStore[] | undefined)?.length ?? 0 })),
    };
  },
});
