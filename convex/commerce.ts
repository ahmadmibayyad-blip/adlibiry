"use node";

import Stripe from "stripe";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { priceIdForVariant } from "./lib/billing";

// Billing runs on Stripe. Setup (keys, prices, webhook): see "Billing" in CLAUDE.md.
function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new ConvexError({ code: "NOT_CONFIGURED", message: "Payments aren't set up yet. Please try again later." });
  return new Stripe(key);
}

export const createCheckout = action({
  args: {
    variantId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to start your trial." });
    const price = priceIdForVariant(args.variantId, process.env);
    if (!price) throw new ConvexError({ code: "NOT_CONFIGURED", message: "This plan isn't available yet. Please try again later." });
    const s = stripe();

    let customerId = user.customerId;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { userId: user._id },
      });
      customerId = customer.id;
      await ctx.runMutation(internal.billing.setCustomerId, { userId: user._id, customerId });
    }

    // 7-day trial without a card, as the Pricing page promises. If no card is
    // added by the end of the trial, the subscription cancels instead of billing.
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user._id,
      line_items: [{ price, quantity: 1 }],
      payment_method_collection: "if_required",
      subscription_data: {
        trial_period_days: 7,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    });
    if (!session.url) throw new ConvexError({ code: "CHECKOUT_FAILED", message: "Couldn't open checkout. Please try again." });
    return { url: session.url };
  },
});

export const getBillingPortal = action({
  args: { returnUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user?.customerId) throw new ConvexError({ code: "NO_CUSTOMER", message: "No billing account yet. Start a plan first." });
    const portal = await stripe().billingPortal.sessions.create({ customer: user.customerId, return_url: args.returnUrl });
    return { url: portal.url };
  },
});

// Stripe → /stripe/webhook (convex/http.ts) → here. Verifies the signature,
// then records subscription changes on the user.
export const handleWebhook = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) return { ok: false, error: "STRIPE_WEBHOOK_SECRET is not set" };
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(args.payload, args.signature, secret);
    } catch {
      return { ok: false, error: "Invalid signature" };
    }
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const item = sub.items.data[0];
      await ctx.runMutation(internal.billing.applySubscription, {
        customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        subscriptionId: sub.id,
        status: sub.status,
        priceId: item?.price.id,
        currentPeriodEnd: item?.current_period_end,
      });
    }
    return { ok: true };
  },
});
