import { v } from "convex/values";
import { action, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { searchKeywords } from "./lib/aliexpress";
import { CJ_API, cjMatches, cjProducts, cjShippingOptions, cjVariant, type CjShipping } from "./lib/cj";

// CJ Dropshipping as a second supplier (lib/cj.ts). Needs Convex env CJ_API_KEY (CJ → My CJ → Authorization →
// API → create a key). When a product page opens, findSuppliers searches CJ by title once (again after 7 days if
// nothing matched) and saves the matches for everyone; shipping() prices the best match to the user's country.
// CJ allows one call a second and an access token lasts 180 days (kept in cjAuth, renewed by its refresh token).

const RETRY_DAYS = 7;
const SHIPPING_CACHE_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
const pause = () => new Promise((r) => setTimeout(r, 1100)); // CJ: 1 request per second

const matchValidator = v.object({
  pid: v.string(),
  title: v.string(),
  price: v.number(),
  url: v.string(),
  imageUrl: v.optional(v.string()),
  listed: v.optional(v.number()),
  inventory: v.optional(v.number()),
  similarity: v.number(),
});
const shippingValidator = v.object({ method: v.string(), priceUsd: v.number(), days: v.string() });

export const auth = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("cjAuth").first(),
});

export const saveAuth = internalMutation({
  args: { accessToken: v.string(), accessExpiresAt: v.number(), refreshToken: v.string(), refreshExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("cjAuth").first();
    if (row) await ctx.db.replace("cjAuth", row._id, args);
    else await ctx.db.insert("cjAuth", args);
  },
});

const expiry = (s: unknown, fallbackDays: number) => {
  const t = Date.parse(String(s ?? "").replace(" ", "T"));
  return Number.isFinite(t) ? t : Date.now() + fallbackDays * DAY_MS;
};

/** A working access token: the saved one, renewed with the refresh token, or a new one from the API key. */
async function accessToken(ctx: ActionCtx): Promise<string | null> {
  const key = process.env.CJ_API_KEY?.trim();
  if (!key) return null;
  const saved = await ctx.runQuery(internal.cj.auth, {});
  const soon = Date.now() + DAY_MS;
  if (saved && saved.accessExpiresAt > soon) return saved.accessToken;
  const renew = saved && saved.refreshExpiresAt > soon;
  const res = await fetch(`${CJ_API}/authentication/${renew ? "refreshAccessToken" : "getAccessToken"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(renew ? { refreshToken: saved.refreshToken } : { apiKey: key }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  const d = body?.data;
  if (!d || typeof d.accessToken !== "string" || typeof d.refreshToken !== "string") {
    console.warn("CJ: no access token", res?.status, JSON.stringify(body ?? {}).slice(0, 200));
    return null;
  }
  await ctx.runMutation(internal.cj.saveAuth, {
    accessToken: d.accessToken,
    accessExpiresAt: expiry(d.accessTokenExpiryDate, 180),
    refreshToken: d.refreshToken,
    refreshExpiresAt: expiry(d.refreshTokenExpiryDate, 180),
  });
  return d.accessToken;
}

async function cj(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`${CJ_API}${path}`, {
    method: init?.method ?? "GET",
    headers: { "CJ-Access-Token": token, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || (body as { result?: boolean } | null)?.result === false) {
    console.warn("CJ:", path.split("?")[0], res.status, JSON.stringify(body ?? {}).slice(0, 200));
    return null;
  }
  return body;
}

export const claimLookup = internalMutation({
  args: { productId: v.id("products"), token: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<{ title: string } | { skip: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { skip: "signed out" };
    const p = await ctx.db.get("products", args.productId);
    if (!p || p.isService) return { skip: "not a product" };
    if (p.cjMatches?.length) return { skip: "already has CJ suppliers" };
    const now = new Date();
    if ((p.cjLookupAt ?? "") > new Date(now.getTime() - RETRY_DAYS * DAY_MS).toISOString()) return { skip: "searched recently" };
    const day = now.toISOString().slice(0, 10);
    const used = await ctx.db.query("cjLookupUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return { skip: "daily limit reached" };
    if (used) await ctx.db.patch("cjLookupUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("cjLookupUsage", { day, count: 1 });
    await ctx.db.patch("products", p._id, { cjLookupAt: now.toISOString() });
    return { title: p.title };
  },
});

export const saveMatches = internalMutation({
  args: { id: v.id("products"), matches: v.array(matchValidator) },
  handler: async (ctx, args) => {
    await ctx.db.patch("products", args.id, { cjMatches: args.matches });
  },
});

/** CJ suppliers for a product without any, when its page opens. */
export const findSuppliers = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ found: number } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { skipped: "signed out" };
    if (!process.env.CJ_API_KEY?.trim()) return { skipped: "CJ_API_KEY isn't set" };
    const limit = Math.max(0, Number(process.env.CJ_LOOKUPS_PER_DAY ?? 500) || 0);
    const claim = await ctx.runMutation(internal.cj.claimLookup, { productId: args.productId, token: stableToken(identity), limit });
    if ("skip" in claim) return { skipped: claim.skip };
    const token = await accessToken(ctx);
    if (!token) return { skipped: "CJ refused the API key" };
    const q = new URLSearchParams({ keyWord: searchKeywords(claim.title), page: "1", size: "20" });
    const body = await cj(token, `/product/listV2?${q}`);
    if (!body) return { skipped: "search failed" };
    const matches = cjMatches(claim.title, cjProducts(body));
    await ctx.runMutation(internal.cj.saveMatches, { id: args.productId, matches });
    return { found: matches.length };
  },
});

export const cachedShipping = internalQuery({
  args: { pid: v.string(), country: v.string() },
  handler: async (ctx, args) => ctx.db.query("cjShipping").withIndex("by_pid_country", (q) => q.eq("pid", args.pid).eq("country", args.country)).first(),
});

export const saveShipping = internalMutation({
  args: { pid: v.string(), country: v.string(), from: v.string(), cheapest: shippingValidator, fastest: shippingValidator },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("cjShipping").withIndex("by_pid_country", (q) => q.eq("pid", args.pid).eq("country", args.country)).first();
    if (old) await ctx.db.patch("cjShipping", old._id, { ...args, at: Date.now() });
    else await ctx.db.insert("cjShipping", { ...args, at: Date.now() });
  },
});

type Shipping = { from: string; cheapest: CjShipping; fastest: CjShipping } | null;

/** Shipping for a CJ product to a country: from a CJ warehouse there when it has stock, else from China. Cached a week. */
export const shipping = action({
  args: { pid: v.string(), country: v.string() },
  handler: async (ctx, args): Promise<Shipping> => {
    if (!(await ctx.auth.getUserIdentity())) return null;
    const country = /^[A-Z]{2}$/.test(args.country) ? args.country : "US";
    if (!/^[\w-]{4,64}$/.test(args.pid)) return null;
    const cached = await ctx.runQuery(internal.cj.cachedShipping, { pid: args.pid, country });
    if (cached && Date.now() - cached.at < SHIPPING_CACHE_MS) return { from: cached.from, cheapest: cached.cheapest, fastest: cached.fastest };
    const token = await accessToken(ctx);
    if (!token) return null;
    const variant = cjVariant(await cj(token, `/product/query?${new URLSearchParams({ pid: args.pid })}`));
    if (!variant) return null;
    const from = variant.stockIn.includes(country) ? country : "CN";
    await pause();
    const options = cjShippingOptions(
      await cj(token, "/logistic/freightCalculate", { method: "POST", body: { startCountryCode: from, endCountryCode: country, products: [{ quantity: 1, vid: variant.vid }] } }),
    );
    if (!options) return null;
    await ctx.runMutation(internal.cj.saveShipping, { pid: args.pid, country, from, ...options });
    return { from, ...options };
  },
});
