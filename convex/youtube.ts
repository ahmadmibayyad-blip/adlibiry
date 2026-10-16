import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { searchKeywords } from "./lib/aliexpress";
import { productVideos, searchIds, youtubeSearchUrl, youtubeVideosUrl, type ProductVideos } from "./lib/youtube";

// Product pages → On YouTube (lib/youtube.ts): searched once per product when its page opens, again after 14 days,
// and saved for everyone. YouTube's free quota allows about 95 searches a day (YOUTUBE_SEARCHES_PER_DAY, default 90).

const REFRESH_DAYS = 14;

export const claim = internalMutation({
  args: { productId: v.id("products"), token: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<{ title: string } | { skip: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { skip: "signed out" };
    const p = await ctx.db.get("products", args.productId);
    if (!p || p.isService) return { skip: "not a product" };
    const now = new Date();
    if ((p.youtubeCheckedAt ?? "") > new Date(now.getTime() - REFRESH_DAYS * 86_400_000).toISOString()) return { skip: "checked recently" };
    const day = now.toISOString().slice(0, 10);
    const used = await ctx.db.query("youtubeUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if ((used?.count ?? 0) >= args.limit) return { skip: "daily limit reached" };
    if (used) await ctx.db.patch("youtubeUsage", used._id, { count: used.count + 1 });
    else await ctx.db.insert("youtubeUsage", { day, count: 1 });
    await ctx.db.patch("products", p._id, { youtubeCheckedAt: now.toISOString() });
    return { title: p.title };
  },
});

export const save = internalMutation({
  args: { productId: v.id("products"), youtube: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch("products", args.productId, { youtube: args.youtube });
  },
});

export const productVideosFor = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ found: number } | { skipped: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { skipped: "signed out" };
    const key = process.env.YOUTUBE_API_KEY?.trim();
    if (!key) return { skipped: "YOUTUBE_API_KEY isn't set" };
    const limit = Math.max(0, Number(process.env.YOUTUBE_SEARCHES_PER_DAY ?? 90) || 0);
    const c = await ctx.runMutation(internal.youtube.claim, { productId: args.productId, token: stableToken(identity), limit });
    if ("skip" in c) return { skipped: c.skip };
    try {
      const search = await fetch(youtubeSearchUrl(searchKeywords(c.title), key), { signal: AbortSignal.timeout(15_000) });
      if (!search.ok) {
        console.warn("YouTube search:", search.status, (await search.text()).slice(0, 200));
        return { skipped: "search failed" };
      }
      const ids = searchIds(await search.json().catch(() => null));
      let found: ProductVideos = { videos: [], totalViews: 0, checkedAt: new Date().toISOString() };
      if (ids.length) {
        const res = await fetch(youtubeVideosUrl(ids, key), { signal: AbortSignal.timeout(15_000) });
        if (res.ok) found = productVideos(await res.json().catch(() => null));
      }
      await ctx.runMutation(internal.youtube.save, { productId: args.productId, youtube: found });
      return { found: found.videos.length };
    } catch (e) {
      console.warn("YouTube failed", e instanceof Error ? e.message : e);
      return { skipped: "search failed" };
    }
  },
});
