import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan, planForPrice, type Plan } from "./lib/billing";

// The signed-in user's plan. A query (not an action) so the app updates the
// moment the Stripe webhook records a new subscription.
export const myPlan = query({
  args: {},
  handler: async (ctx): Promise<Plan> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return "none";
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    return effectivePlan(user);
  },
});

export const setCustomerId = internalMutation({
  args: { userId: v.id("users"), customerId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("users", args.userId, { customerId: args.customerId });
  },
});

export const userByCustomerId = internalQuery({
  args: { customerId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("users")
      .withIndex("by_customer_id", (q) => q.eq("customerId", args.customerId))
      .unique(),
});

// Called by the Stripe webhook for every subscription change.
export const applySubscription = internalMutation({
  args: {
    customerId: v.string(),
    subscriptionId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()), // seconds, as Stripe sends it
  },
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_customer_id", (q) => q.eq("customerId", args.customerId))
      .unique();
    if (!user) return { updated: false };
    await ctx.db.patch("users", user._id, {
      plan: planForPrice(args.priceId, process.env),
      subscriptionStatus: args.status,
      subscriptionId: args.subscriptionId,
      planRenewsAt: args.currentPeriodEnd ? args.currentPeriodEnd * 1000 : undefined,
    });
    return { updated: true };
  },
});
