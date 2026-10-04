import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { effectivePlan } from "./lib/billing";
import {
  BackendError,
  PRO_PRICE_CENTS,
  appPlan,
  backendUrl,
  createPaymentIntent,
  fetchPaymentIntent,
  fetchSubscription,
  isProPayment,
  startSubscription,
} from "./lib/adspyBackend";

// Pro (€35 / month) through the AdSpy Pro backend and Stripe:
// 1. createProPayment: the backend creates a PaymentIntent for €35
//    (POST /subscription/pay) and the browser pays it with Stripe Elements.
// 2. confirmProPayment: this server checks with Stripe that the payment went
//    through (status, amount, currency), that it wasn't used before, then
//    starts the subscription on the backend (POST /subscription/start) and
//    marks the user Pro here. The browser's word is never enough.
// The backend calls use the user's token saved at sign-in (backendSessions).
// Needs STRIPE_SECRET_KEY: a secret (or restricted, PaymentIntents read) key of
// the same Stripe account as the backend's SECRET_KEY.

const fail = (code: string, message: string) => new ConvexError({ code, message });
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,64}$/;

export const backendToken = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    (await ctx.db.query("backendSessions").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique())?.token ?? null,
});

// One payment activates Pro once, for one user. "ok" again for the same user
// (a retry after the backend call failed); "taken" if another user used it.
export const claimPayment = internalMutation({
  args: { paymentIntentId: v.string(), userId: v.id("users"), amount: v.number(), currency: v.string() },
  handler: async (ctx, args): Promise<"ok" | "taken"> => {
    const used = await ctx.db
      .query("proPayments")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
      .unique();
    if (used) return used.userId === args.userId ? "ok" : "taken";
    await ctx.db.insert("proPayments", { ...args, at: Date.now() });
    return "ok";
  },
});

export const setPro = internalMutation({
  args: { userId: v.id("users"), subscription: v.optional(v.object({ isSubscribed: v.boolean(), planName: v.string() })) },
  handler: async (ctx, args) => {
    // The backend's answer when we have it; otherwise the verified payment.
    const plan = args.subscription?.isSubscribed ? appPlan(args.subscription) : { plan: "pro" as const, subscriptionStatus: "active" };
    await ctx.db.patch("users", args.userId, plan);
  },
});

type Ctx = ActionCtx;

async function signedInUser(ctx: Ctx) {
  const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
  if (!user) throw fail("UNAUTHENTICATED", "Please sign in to upgrade.");
  return user;
}

async function tokenFor(ctx: Ctx, userId: Id<"users">): Promise<string> {
  const token = await ctx.runQuery(internal.proPlan.backendToken, { userId });
  if (!token) throw fail("SIGN_IN_AGAIN", "Please sign out and sign in again, then upgrade.");
  return token;
}

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw fail("NOT_CONFIGURED", "Payments aren't set up yet. Please try again later.");
  return key;
}

const backendCall = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BackendError) throw fail(e.code === "invalid" ? "SIGN_IN_AGAIN" : "UNAVAILABLE", e.message);
    throw e;
  }
};

export const createProPayment = action({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string; amount: number; currency: string }> => {
    const user = await signedInUser(ctx);
    if (effectivePlan(user) !== "none" && user.subscriptionStatus === "active") throw fail("ALREADY_PRO", "You already have Pro.");
    // Check before anyone pays: without the key a payment couldn't be verified.
    stripeKey();
    const token = await tokenFor(ctx, user._id);
    const clientSecret = await backendCall(() => createPaymentIntent(backendUrl(process.env), token, process.env));
    return { clientSecret, amount: PRO_PRICE_CENTS, currency: "eur" };
  },
});

export const confirmProPayment = action({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args): Promise<{ plan: "pro" }> => {
    const user = await signedInUser(ctx);
    if (!PAYMENT_INTENT_ID.test(args.paymentIntentId)) throw fail("BAD_REQUEST", "Unknown payment.");
    const pi = await backendCall(() => fetchPaymentIntent(stripeKey(), args.paymentIntentId));
    if (!pi) throw fail("BAD_REQUEST", "Unknown payment.");
    if (!isProPayment(pi)) {
      throw fail(
        "NOT_PAID",
        pi.status === "processing" ? "Your payment is still processing. Pro switches on as soon as it clears; check back in a few minutes." : "This payment didn't go through.",
      );
    }
    const claim = await ctx.runMutation(internal.proPlan.claimPayment, {
      paymentIntentId: pi.id,
      userId: user._id,
      amount: pi.amount_received ?? pi.amount,
      currency: pi.currency,
    });
    if (claim === "taken") throw fail("BAD_REQUEST", "This payment was already used.");

    const base = backendUrl(process.env);
    const token = await tokenFor(ctx, user._id);
    await backendCall(() => startSubscription(base, token, process.env, pi.id));
    let subscription = null;
    try {
      subscription = await fetchSubscription(base, token, process.env);
    } catch {
      /* the verified payment is enough */
    }
    await ctx.runMutation(internal.proPlan.setPro, { userId: user._id, ...(subscription ? { subscription } : {}) });
    return { plan: "pro" };
  },
});

// ── Daily: Pro ends when the backend says the month is over ────────────────
// Pro doesn't renew by itself, and the plan is otherwise only read at sign-in,
// so every day each active plan is checked against /user/checkSubscription
// (which also expires the subscription on the backend). A Stripe subscription
// made in this app before the switch (subscriptionId) is left alone.

const REFRESH_PAGE = 100;

export const sessionsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("backendSessions").paginate({ cursor: args.cursor, numItems: REFRESH_PAGE });
    const due = [];
    for (const s of page.page) {
      const user = await ctx.db.get("users", s.userId);
      if (user && user.subscriptionStatus === "active" && !user.subscriptionId) due.push({ userId: s.userId, token: s.token });
    }
    return { due, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const applyBackendPlan = internalMutation({
  args: { userId: v.id("users"), subscription: v.object({ isSubscribed: v.boolean(), planName: v.string() }) },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.subscriptionId) return;
    await ctx.db.patch("users", args.userId, appPlan(args.subscription));
  },
});

export const refreshPlans = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ checked: number }> => {
    const page = await ctx.runQuery(internal.proPlan.sessionsPage, { cursor: args.cursor ?? null });
    const base = backendUrl(process.env);
    let checked = 0;
    for (const { userId, token } of page.due) {
      try {
        const subscription = await fetchSubscription(base, token, process.env);
        if (subscription) {
          await ctx.runMutation(internal.proPlan.applyBackendPlan, { userId, subscription });
          checked += 1;
        }
      } catch {
        /* backend unreachable: keep the plan, try again tomorrow */
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.proPlan.refreshPlans, { cursor: page.cursor });
    return { checked };
  },
});
