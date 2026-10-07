import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { NICHES } from "./lib/category";

// Onboarding: right after sign-up we ask which niches the user sells in. They
// pre-filter Winning Products, Products and Ad Spy and choose what the morning
// digest shows; the browser's timezone times that digest. Changed any time in
// Settings.

async function me(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await me(ctx);
    if (!user) return null;
    const prefs = await ctx.db.query("alertPreferences").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return {
      niches: user.niches ?? [],
      onboarded: !!user.onboardedAt,
      timezone: user.timezone ?? null,
      targetCountry: user.targetCountry ?? null,
      digest: prefs?.emailDigestEnabled ?? false,
    };
  },
});

const niche = v.union(...NICHES.map((n) => v.literal(n)));

async function savePrefs(ctx: MutationCtx, userId: Id<"users">, patch: { watchedNiches?: string[]; emailDigestEnabled?: boolean }) {
  const prefs = await ctx.db.query("alertPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  const updatedAt = new Date().toISOString();
  if (prefs) await ctx.db.patch("alertPreferences", prefs._id, { ...patch, updatedAt });
  else
    await ctx.db.insert("alertPreferences", {
      userId,
      watchedNiches: patch.watchedNiches ?? [],
      notifyNewWinners: true,
      notifyNewAdsInNiches: true,
      notifyTrackedStoreUpdates: true,
      emailDigestEnabled: patch.emailDigestEnabled ?? false,
      unsubscribeToken: crypto.randomUUID(),
      updatedAt,
    });
}

// The onboarding answer (or "Skip": no niches, digest off).
export const complete = mutation({
  args: { niches: v.array(niche), timezone: v.optional(v.string()), digest: v.boolean(), targetCountry: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const niches = [...new Set(args.niches)];
    await ctx.db.patch("users", user._id, {
      niches,
      onboardedAt: new Date().toISOString(),
      ...(args.timezone && args.timezone.length <= 64 ? { timezone: args.timezone } : {}),
      ...(args.targetCountry && /^[A-Z]{2}$/.test(args.targetCountry) ? { targetCountry: args.targetCountry } : {}),
    });
    await savePrefs(ctx, user._id, { watchedNiches: niches, emailDigestEnabled: args.digest });
  },
});

// Settings: one tap adds or removes a niche.
export const setNiches = mutation({
  args: { niches: v.array(niche) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const niches = [...new Set(args.niches)];
    await ctx.db.patch("users", user._id, { niches, onboardedAt: user.onboardedAt ?? new Date().toISOString() });
    await savePrefs(ctx, user._id, { watchedNiches: niches });
  },
});

// Settings: the country they sell to.
export const setTargetCountry = mutation({
  args: { country: v.string() },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    if (!/^[A-Z]{2}$/.test(args.country)) throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a country." });
    await ctx.db.patch("users", user._id, { targetCountry: args.country });
  },
});

export const setDigest = mutation({
  args: { enabled: v.boolean(), timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    if (args.timezone && args.timezone.length <= 64) await ctx.db.patch("users", user._id, { timezone: args.timezone });
    await savePrefs(ctx, user._id, { emailDigestEnabled: args.enabled });
  },
});
