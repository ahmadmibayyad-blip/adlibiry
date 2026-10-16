import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";
import { internal } from "./_generated/api";
import { pageSpeedUrl, speedRun, type SpeedRun } from "./lib/pageSpeed";

// Store Inspector → "Check speed": PageSpeed Insights for a store's home page on a phone and a desktop
// (lib/pageSpeed.ts), kept 24 hours per store for everyone. Signed-in users only.

const CACHE_MS = 86_400_000;
type Speed = { mobile: SpeedRun | null; desktop: SpeedRun | null; checkedAt: number };

export const cached = internalQuery({
  args: { host: v.string() },
  handler: async (ctx, args) => ctx.db.query("storeSpeeds").withIndex("by_host", (q) => q.eq("host", args.host)).first(),
});

export const save = internalMutation({
  args: { host: v.string(), result: v.any() },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("storeSpeeds").withIndex("by_host", (q) => q.eq("host", args.host)).first();
    if (old) await ctx.db.patch("storeSpeeds", old._id, { result: args.result, at: Date.now() });
    else await ctx.db.insert("storeSpeeds", { host: args.host, result: args.result, at: Date.now() });
  },
});

export const check = action({
  args: { host: v.string() },
  handler: async (ctx, args): Promise<Speed> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const host = args.host.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new ConvexError({ code: "BAD_LINK", message: "That isn't a store address." });
    const hit = await ctx.runQuery(internal.storeSpeed.cached, { host });
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.result as Speed;
    const key = process.env.PAGESPEED_API_KEY?.trim();
    if (!key) throw new ConvexError({ code: "NOT_SET_UP", message: "Speed checks aren't switched on yet (PAGESPEED_API_KEY)." });
    const run = async (strategy: "mobile" | "desktop") => {
      try {
        const res = await fetch(pageSpeedUrl(`https://${host}/`, strategy, key), { signal: AbortSignal.timeout(90_000) });
        if (!res.ok) console.warn("PageSpeed:", host, strategy, res.status, (await res.text()).slice(0, 200));
        return res.ok ? speedRun(await res.json().catch(() => null)) : null;
      } catch {
        return null;
      }
    };
    const [mobile, desktop] = await Promise.all([run("mobile"), run("desktop")]);
    if (!mobile && !desktop) throw new ConvexError({ code: "FAILED", message: `Google couldn't test ${host} right now (a password page or a block). Try again later.` });
    const result: Speed = { mobile, desktop, checkedAt: Date.now() };
    await ctx.runMutation(internal.storeSpeed.save, { host, result });
    return result;
  },
});

/** The user's own connected store, to compare speeds with. */
export const myStore = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return store ? { host: store.shopDomain, name: store.shopName } : null;
  },
});
