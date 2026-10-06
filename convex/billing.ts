import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";
import { resultLimitFor } from "./lib/access";
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

// How many results per list the signed-in user sees (null: all). The app shows
// a notice on list pages when this is set.
export const myResultLimit = query({
  args: {},
  handler: async (ctx): Promise<number | null> => await resultLimitFor(ctx),
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
    eventCreated: v.optional(v.number()), // Stripe event.created, seconds
  },
  handler: async (ctx, args): Promise<{ updated: boolean; reason?: "unknown_customer" | "stale_event" }> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_customer_id", (q) => q.eq("customerId", args.customerId))
      .unique();
    if (!user) return { updated: false, reason: "unknown_customer" };
    // Stripe doesn't guarantee delivery order: never let an older event
    // (e.g. a late "updated") overwrite a newer one (e.g. "deleted").
    if (args.eventCreated !== undefined && user.subscriptionEventAt !== undefined && args.eventCreated < user.subscriptionEventAt) {
      return { updated: false, reason: "stale_event" };
    }
    await ctx.db.patch("users", user._id, {
      plan: planForPrice(args.priceId, process.env),
      subscriptionStatus: args.status,
      subscriptionId: args.subscriptionId,
      planRenewsAt: args.currentPeriodEnd ? args.currentPeriodEnd * 1000 : undefined,
      subscriptionEventAt: args.eventCreated ?? user.subscriptionEventAt,
    });
    return { updated: true };
  },
});
