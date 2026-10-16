import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import { GOOGLE_AD_LOOKUPS, GOOGLE_AD_PLATFORMS, googleAds, googleAdsUrl, type GoogleAdPlatform, type GoogleAdsResult } from "./lib/googleAds";

// Store Inspector → "Google & YouTube ads": the store's ads in Google's Ads Transparency Center (lib/googleAds.ts).
// Answers are kept 24 hours per store and platform for everyone; a new lookup counts toward the user's day.

const CACHE_MS = 86_400_000;
const DAY_MS = 86_400_000;

export const before = internalQuery({
  args: { token: v.string(), host: v.string(), platform: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const limit = byTier(user, GOOGLE_AD_LOOKUPS);
    const used = (await ctx.db.query("googleAdRuns").withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS)).take(limit)).length;
    const cached = await ctx.db.query("googleAdLookups").withIndex("by_host_platform", (q) => q.eq("host", args.host).eq("platform", args.platform)).first();
    const fresh = cached && Date.now() - cached.at < CACHE_MS ? (cached.result as GoogleAdsResult) : null;
    return { userId: user._id, used, limit, fresh };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), host: v.string(), platform: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert("googleAdRuns", { userId: args.userId, at: Date.now() });
    const old = await ctx.db.query("googleAdLookups").withIndex("by_host_platform", (q) => q.eq("host", args.host).eq("platform", args.platform)).first();
    if (old) await ctx.db.patch("googleAdLookups", old._id, { result: args.result, at: Date.now() });
    else await ctx.db.insert("googleAdLookups", { host: args.host, platform: args.platform, result: args.result, at: Date.now() });
  },
});

export const forStore = action({
  args: { host: v.string(), platform: v.optional(v.string()) },
  handler: async (ctx, args): Promise<GoogleAdsResult & { cached: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const host = args.host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new ConvexError({ code: "BAD_LINK", message: "That isn't a store address." });
    const platform: GoogleAdPlatform = GOOGLE_AD_PLATFORMS.includes(args.platform as GoogleAdPlatform) ? (args.platform as GoogleAdPlatform) : "all";
    const pre = await ctx.runQuery(internal.googleAds.before, { token: stableToken(identity), host, platform });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (pre.fresh) return { ...pre.fresh, cached: true };
    if (pre.used >= pre.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message: pre.limit <= GOOGLE_AD_LOOKUPS.trial ? `You've looked up ${pre.limit} stores' Google ads today. Upgrade to Pro for ${GOOGLE_AD_LOOKUPS.paid} a day.` : `You've looked up ${pre.limit} stores' Google ads today. Try again tomorrow.`,
      });
    }
    const key = process.env.SCRAPECREATORS_API_KEY?.trim();
    if (!key) throw new ConvexError({ code: "NOT_SET_UP", message: "Google ads aren't switched on yet (SCRAPECREATORS_API_KEY)." });
    const res = await fetch(googleAdsUrl(host, platform), { headers: { "x-api-key": key }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const text = res ? await res.text() : "";
    if (!res?.ok) {
      console.warn("Google ads:", host, res?.status, text.slice(0, 200));
      const credit = res?.status === 402 || /credit/i.test(text);
      throw new ConvexError({ code: credit ? "BUDGET" : "FAILED", message: credit ? "Google ads have used up their credit. The site owner needs to top up ScrapeCreators." : `We couldn't read ${host}'s Google ads. Try again in a minute.` });
    }
    let parsed: GoogleAdsResult | null = null;
    try {
      parsed = googleAds(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (!parsed) throw new ConvexError({ code: "FAILED", message: `We couldn't read ${host}'s Google ads. Try again in a minute.` });
    await ctx.runMutation(internal.googleAds.save, { userId: pre.userId, host, platform, result: parsed });
    return { ...parsed, cached: false };
  },
});
