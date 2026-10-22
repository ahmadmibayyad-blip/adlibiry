import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { PICTURE_ACTOR, fromPictureSearch, pictureLimit } from "./lib/aliexpress";

// ── Suppliers matched by picture ────────────────────────────────────────────
// When a signed-in user opens a product page, findByPicture runs AliExpress's
// visual search on the product photo through Apify (lib/aliexpress.ts
// PICTURE_ACTOR, ~$0.006) and saves the look-alike listings on the product for
// everyone (`pictureMatches`). Once per product, again after 30 days (7 when
// nothing was found); PICTURE_LOOKUPS_PER_DAY (default 300, 0 = off) across
// all users. Needs APIFY_TOKEN.

const RECHECK_DAYS = 30;
const RETRY_DAYS = 7;
const usageKey = (day: string) => `picture:${day}`; // shares supplierLookupUsage with the title search

export const claim = internalMutation({
  args: { productId: v.id("products"), token: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<{ imageUrl: string; title: string; price?: number } | { skip: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { skip: "signed out" };
    const p = await ctx.db.get("products", args.productId);
    if (!p || p.isService) return { skip: "not a product" };
    if (!/^https:\/\//.test(p.imageUrl)) return { skip: "no photo" };
    const now = new Date();
    const wait = p.pictureMatches?.length ? RECHECK_DAYS : RETRY_DAYS;
    if ((p.pictureLookupAt ?? "") > new Date(now.getTime() - wait * 86_400_000).toISOString()) return { skip: "searched recently" };
    const day = usageKey(now.toISOString().slice(0, 10));
    const used = await ctx.db.query("supplierLookupUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return { skip: "daily limit reached" };
    if (used) await ctx.db.patch("supplierLookupUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("supplierLookupUsage", { day, count: 1 });
    await ctx.db.patch("products", p._id, { pictureLookupAt: now.toISOString() });
    return { imageUrl: p.imageUrl, title: p.title, ...(p.price ? { price: p.price } : {}) };
  },
});

// Search by image (imageSearch.ts): one picture search for a signed-in user's own photo, counted in the same daily cap.
export const claimDay = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    if (!(await ctx.auth.getUserIdentity())) return false;
    const day = usageKey(new Date().toISOString().slice(0, 10));
    const used = await ctx.db.query("supplierLookupUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return false;
    if (used) await ctx.db.patch("supplierLookupUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("supplierLookupUsage", { day, count: 1 });
    return true;
  },
});

/** The same daily count for Offer Search's automatic matches, which run with no user signed in (a webhook). */
export const claimForSearch = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const day = usageKey(new Date().toISOString().slice(0, 10));
    const used = await ctx.db.query("supplierLookupUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return false;
    if (used) await ctx.db.patch("supplierLookupUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("supplierLookupUsage", { day, count: 1 });
    return true;
  },
});

const matchValidator = v.object({
  title: v.string(),
  price: v.number(),
  url: v.string(),
  imageUrl: v.optional(v.string()),
  orders: v.optional(v.number()),
});

export const save = internalMutation({
  args: { id: v.id("products"), matches: v.array(matchValidator) },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get("products", args.id))) return;
    await ctx.db.patch("products", args.id, { pictureMatches: args.matches });
  },
});

export const findByPicture = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ found: number } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { skipped: "signed out" };
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) return { skipped: "APIFY_TOKEN isn't set" };
    const limit = pictureLimit();
    const c = await ctx.runMutation(internal.aliexpressImage.claim, { productId: args.productId, token: stableToken(identity), limit });
    if ("skip" in c) return { skipped: c.skip };
    try {
      const q = new URLSearchParams({ token, timeout: "60", maxTotalChargeUsd: "0.02" });
      const res = await fetch(`https://api.apify.com/v2/acts/${PICTURE_ACTOR}/run-sync-get-dataset-items?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: c.imageUrl, destination: "aliexpress", language: "en", currency: "USD" }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!res.ok) {
        console.warn("Picture suppliers: Apify", res.status, (await res.text()).slice(0, 200));
        return { skipped: "search failed" };
      }
      const matches = fromPictureSearch(await res.json().catch(() => null), { price: c.price, title: c.title });
      await ctx.runMutation(internal.aliexpressImage.save, { id: args.productId, matches });
      return { found: matches.length };
    } catch (e) {
      console.warn("Picture suppliers failed", e);
      return { skipped: "search failed" };
    }
  },
});
