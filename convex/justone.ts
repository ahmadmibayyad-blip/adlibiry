import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import {
  aliexpressBySales,
  amazonMarket,
  amazonResults,
  MARKET_KINDS,
  MARKET_REFRESH_DAYS,
  MARKET_RETRY_DAYS,
  marketDue,
  marketKey,
  shortKeywords,
  TIKTOK_SHOP_REGIONS,
  TIKTOK_SHOP_SEARCHES,
  tiktokShopProducts,
  tiktokVideos,
  type MarketEntry,
  type MarketKind,
  type ProductMarkets,
  type TikTokShopItem,
} from "./lib/justone";

// JustOne API (api.justoneapi.com): one token for AliExpress, Amazon, TikTok, TikTok Shop and more, billed per
// successful call. The token is JUSTONE_API_KEY (justone_api_key also works).
// - Product page (marketsFor): AliExpress best sellers, Amazon in the user's marketplace, most-liked TikTok videos of the
//   last 30 days and TikTok Shop (US), saved on the product for everyone (`markets`), again after a week (a day after a
//   failure). `JUSTONE_LOOKUPS_PER_DAY` (default 300) caps each kind per day for all users (`justoneUsage`).
// - TikTok Shop page → Search TikTok Shop (tiktokShopSearch): a live search, kept 24 h per keyword and region, with a
//   per-user daily limit (TIKTOK_SHOP_SEARCHES).
// - `probe` is for trying endpoints from the Convex dashboard (Functions → justone:probe).

const BASE = "https://api.justoneapi.com";
const DAY_MS = 86_400_000;
const SEARCH_CACHE_MS = DAY_MS;

const ERRORS: Record<number, string> = {
  100: "the token is wrong or switched off",
  301: "JustOne couldn't collect it, try again",
  302: "too many requests",
  303: "the daily quota is used up",
  400: "bad parameters",
  600: "this token can't use that endpoint",
  601: "the JustOne balance is empty",
  602: "this token's budget is used up",
};

export function justoneToken(): string | undefined {
  return (process.env.JUSTONE_API_KEY ?? process.env.justone_api_key)?.trim() || undefined;
}

/** GET a JustOne endpoint and return its `data`; throws a short message for any non-zero code. */
export async function justoneGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const token = justoneToken();
  if (!token) throw new Error("JUSTONE_API_KEY isn't set");
  const q = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) if (val !== undefined && val !== "") q.set(k, String(val));
  q.set("token", token);
  const res = await fetch(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let body: { code?: number; message?: string; data?: unknown } | null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`JustOne answered ${res.status}: ${text.slice(0, 200)}`);
  }
  if (body?.code !== 0) throw new Error(`JustOne ${body?.code}: ${ERRORS[body?.code ?? -1] ?? body?.message ?? "failed"}`);
  return body.data;
}

/** Cuts long arrays and strings so a dashboard run shows the shape of an answer. */
function sample(x: unknown, depth = 0): unknown {
  if (typeof x === "string") return x.length > 300 ? `${x.slice(0, 300)}…` : x;
  if (Array.isArray(x)) {
    const head = x.slice(0, depth === 0 ? 5 : 3).map((y) => sample(y, depth + 1));
    return x.length > head.length ? [...head, `…${x.length} items`] : head;
  }
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, sample(y, depth + 1)]));
  return x;
}

export const probe = internalAction({
  args: { path: v.string(), params: v.optional(v.any()), full: v.optional(v.boolean()) },
  handler: async (_ctx, args) => {
    const data = await justoneGet(args.path, (args.params ?? {}) as Record<string, string>);
    return args.full ? data : sample(data);
  },
});

// ---- Product page ----

const dailyLimit = () => Math.max(0, Number(process.env.JUSTONE_LOOKUPS_PER_DAY ?? 300) || 0);

/** Which lookups are due for this product and still within today's cap; marks them as taken. */
export const claimMarkets = internalMutation({
  args: { productId: v.id("products"), token: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<{ title: string; amazonCountry: string; kinds: MarketKind[] } | { skip: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { skip: "signed out" };
    const p = await ctx.db.get("products", args.productId);
    if (!p || p.isService) return { skip: "not a product" };
    const amazonCountry = amazonMarket(user.targetCountry);
    const markets = (p.markets ?? {}) as ProductMarkets;
    const checked = { ...((p.marketsChecked ?? {}) as Record<string, string>) };
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const kinds: MarketKind[] = [];
    for (const kind of MARKET_KINDS) {
      const key = marketKey(kind, amazonCountry);
      const entry = kind === "amazon" ? markets.amazon?.[amazonCountry] : markets[kind];
      if (!marketDue(checked[key], entry?.failed, now)) continue;
      const used = await ctx.db.query("justoneUsage").withIndex("by_day_kind", (q) => q.eq("day", day).eq("kind", kind)).unique();
      if ((used?.count ?? 0) >= args.limit) continue;
      if (used) await ctx.db.patch("justoneUsage", used._id, { count: used.count + 1 });
      else await ctx.db.insert("justoneUsage", { day, kind, count: 1 });
      checked[key] = new Date(now).toISOString();
      kinds.push(kind);
    }
    if (!kinds.length) return { skip: "nothing due" };
    await ctx.db.patch("products", p._id, { marketsChecked: checked });
    return { title: p.title, amazonCountry, kinds };
  },
});

/** Saves one lookup. A failed one keeps the last good items and is tried again after a day. */
export const saveMarket = internalMutation({
  args: { productId: v.id("products"), kind: v.string(), amazonCountry: v.string(), entry: v.any() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("products", args.productId);
    if (!p) return;
    const markets = { ...((p.markets ?? {}) as ProductMarkets) };
    const entry = args.entry as MarketEntry<unknown>;
    if (args.kind === "amazon") {
      const old = markets.amazon?.[args.amazonCountry];
      markets.amazon = { ...markets.amazon, [args.amazonCountry]: entry.failed && old ? { ...old, failed: true, at: entry.at } : (entry as MarketEntry<never>) };
    } else {
      const kind = args.kind as Exclude<MarketKind, "amazon">;
      const old = markets[kind];
      markets[kind] = (entry.failed && old ? { ...old, failed: true, at: entry.at } : entry) as never;
    }
    const patch: { markets: ProductMarkets; marketsChecked?: Record<string, string> } = { markets };
    if (entry.failed) {
      // Due again after MARKET_RETRY_DAYS instead of a week.
      const checked = { ...((p.marketsChecked ?? {}) as Record<string, string>) };
      checked[marketKey(args.kind as MarketKind, args.amazonCountry)] = new Date(Date.now() - (MARKET_REFRESH_DAYS - MARKET_RETRY_DAYS) * DAY_MS).toISOString();
      patch.marketsChecked = checked;
    }
    await ctx.db.patch("products", p._id, patch);
  },
});

async function lookUp(kind: MarketKind, title: string, amazonCountry: string): Promise<MarketEntry<unknown>> {
  const at = new Date().toISOString();
  if (kind === "aliexpress") {
    const r = aliexpressBySales(await justoneGet("/api/aliexpress/search-products/v1", { q: shortKeywords(title, 6), sort: "salesDesc", currency: "USD" }));
    return { at, items: r.items.slice(0, 8), total: r.total };
  }
  if (kind === "amazon") {
    const r = amazonResults(await justoneGet("/api/amazon/search-products/v1", { keyword: shortKeywords(title, 5), country: amazonCountry }));
    return { at, items: r.items.slice(0, 8), total: r.total, country: amazonCountry };
  }
  if (kind === "tiktok") {
    const videos = tiktokVideos(await justoneGet("/api/tiktok/search-post/v1", { keyword: shortKeywords(title, 4), sortType: "MOST_LIKED", publishTime: "ONE_MONTH" }));
    return { at, items: videos.slice(0, 8) };
  }
  const r = tiktokShopProducts(await justoneGet("/api/tiktok-shop/search-products/v1", { keyword: shortKeywords(title, 4), region: "US" }));
  return { at, items: r.items.slice(0, 8), country: "US" };
}

/** Product page: looks up whatever is due (all four the first time) and saves each on the product as it arrives. */
export const marketsFor = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ looked: MarketKind[] } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { skipped: "signed out" };
    if (!justoneToken()) return { skipped: "JUSTONE_API_KEY isn't set" };
    const c = await ctx.runMutation(internal.justone.claimMarkets, { productId: args.productId, token: stableToken(identity), limit: dailyLimit() });
    if ("skip" in c) return { skipped: c.skip };
    await Promise.all(
      c.kinds.map(async (kind) => {
        let entry: MarketEntry<unknown>;
        try {
          entry = await lookUp(kind, c.title, c.amazonCountry);
        } catch (e) {
          console.warn("JustOne", kind, e instanceof Error ? e.message : e);
          entry = { at: new Date().toISOString(), items: [], failed: true };
        }
        await ctx.runMutation(internal.justone.saveMarket, { productId: args.productId, kind, amazonCountry: c.amazonCountry, entry });
      }),
    );
    return { looked: c.kinds };
  },
});

// ---- TikTok Shop page → Search TikTok Shop ----

type ShopSearch = { items: TikTokShopItem[]; keyword: string; region: string; at: number };

export const beforeShopSearch = internalQuery({
  args: { token: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const limit = byTier(user, TIKTOK_SHOP_SEARCHES);
    const used = (await ctx.db.query("tiktokShopRuns").withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS)).take(limit)).length;
    const cached = await ctx.db.query("tiktokShopSearches").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    const fresh = cached && Date.now() - cached.at < SEARCH_CACHE_MS ? (cached.result as ShopSearch) : null;
    return { userId: user._id, used, limit, fresh };
  },
});

export const saveShopSearch = internalMutation({
  args: { userId: v.id("users"), key: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert("tiktokShopRuns", { userId: args.userId, at: Date.now() });
    const old = await ctx.db.query("tiktokShopSearches").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (old) await ctx.db.patch("tiktokShopSearches", old._id, { result: args.result, at: Date.now() });
    else await ctx.db.insert("tiktokShopSearches", { key: args.key, result: args.result, at: Date.now() });
  },
});

export const tiktokShopSearch = action({
  args: { keyword: v.string(), region: v.optional(v.string()) },
  handler: async (ctx, args): Promise<ShopSearch & { cached: boolean; left: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const keyword = args.keyword.trim().replace(/\s+/g, " ").slice(0, 80);
    if (keyword.length < 2) throw new ConvexError({ code: "BAD_INPUT", message: "Type a product word to search for." });
    const region = (TIKTOK_SHOP_REGIONS as readonly string[]).includes(args.region ?? "") ? (args.region as string) : "US";
    const key = `${region}:${keyword.toLowerCase()}`;
    const pre = await ctx.runQuery(internal.justone.beforeShopSearch, { token: stableToken(identity), key });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (pre.fresh) return { ...pre.fresh, cached: true, left: Math.max(0, pre.limit - pre.used) };
    if (pre.used >= pre.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message: pre.limit <= TIKTOK_SHOP_SEARCHES.trial ? `You've searched TikTok Shop ${pre.limit} times today. Upgrade to Pro for ${TIKTOK_SHOP_SEARCHES.paid} a day.` : `You've searched TikTok Shop ${pre.limit} times today. Try again tomorrow.`,
      });
    }
    if (!justoneToken()) throw new ConvexError({ code: "NOT_SET_UP", message: "TikTok Shop search isn't switched on yet (JUSTONE_API_KEY)." });
    let items: TikTokShopItem[];
    try {
      const r = tiktokShopProducts(await justoneGet("/api/tiktok-shop/search-products/v1", { keyword, region }));
      if (r.unsupported) throw new ConvexError({ code: "REGION", message: `TikTok Shop search doesn't cover ${region} yet. Try the US.` });
      items = r.items;
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      console.warn("TikTok Shop search:", e instanceof Error ? e.message : e);
      const empty = e instanceof Error && /balance|budget/.test(e.message);
      throw new ConvexError({ code: "FAILED", message: empty ? "TikTok Shop search has used up its credit. The site owner needs to top up JustOne." : "TikTok Shop didn't answer. Try again in a minute." });
    }
    const result: ShopSearch = { items, keyword, region, at: Date.now() };
    await ctx.runMutation(internal.justone.saveShopSearch, { userId: pre.userId, key, result });
    return { ...result, cached: false, left: Math.max(0, pre.limit - pre.used - 1) };
  },
});
