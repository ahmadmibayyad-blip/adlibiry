import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { effectivePlan } from "./lib/billing";
import {
  BackendError,
  PRO_PRICES,
  addPeriod,
  type BillingPeriod,
  type BackendSubscription,
  appPlan,
  backendUrl,
  createPaymentIntent,
  fetchPaymentIntent,
  fetchSubscription,
  isProPayment,
  startSubscription,
} from "./lib/adspyBackend";
import { StripeApiError, chargeSavedCard, createCustomer, saveCardOnPayment } from "./lib/stripeApi";
import { stableToken } from "./lib/authIdentity";

// Pro (€35 / month, or €360 / year) through the AdSpy Pro backend and Stripe:
// 1. createProPayment: the backend creates a PaymentIntent for €35
//    or €360 (POST /subscription/pay) and the browser pays it with Stripe Elements.
// 2. confirmProPayment: this server checks with Stripe that the payment went
//    through (status, amount, currency), that it wasn't used before, then
//    starts the subscription on the backend (POST /subscription/start) and
//    marks the user Pro here. The browser's word is never enough.
// The backend calls use the user's token saved at sign-in (backendSessions).
// Needs STRIPE_SECRET_KEY: a secret (or restricted, PaymentIntents read) key of
// the same Stripe account as the backend's SECRET_KEY.

const fail = (code: string, message: string) => new ConvexError({ code, message });
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,64}$/;
const period = v.union(v.literal("monthly"), v.literal("yearly"));

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
  args: { period, autoRenew: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ clientSecret: string; amount: number; currency: string; autoRenew: boolean }> => {
    const user = await signedInUser(ctx);
    if (effectivePlan(user) !== "none" && user.subscriptionStatus === "active") throw fail("ALREADY_PRO", "You already have Pro.");
    // Check before anyone pays: without the key a payment couldn't be verified.
    stripeKey();
    const token = await tokenFor(ctx, user._id);
    const clientSecret = await backendCall(() => createPaymentIntent(backendUrl(process.env), token, process.env, args.period));
    // Auto-renew: keep the card on this payment for the renewal charges.
    let autoRenew = false;
    if (args.autoRenew !== false) {
      const paymentIntentId = clientSecret.split("_secret_")[0];
      try {
        let customerId = await ctx.runQuery(internal.proPlan.billingCustomer, { userId: user._id });
        if (!customerId) {
          customerId = await createCustomer(stripeKey(), { email: user.email, name: user.name, userId: user._id });
          await ctx.runMutation(internal.proPlan.saveBilling, { userId: user._id, period: args.period, customerId });
        }
        if (PAYMENT_INTENT_ID.test(paymentIntentId)) {
          await saveCardOnPayment(stripeKey(), paymentIntentId, customerId, { userId: user._id, period: args.period, kind: "pro" });
          autoRenew = true;
        }
      } catch (e) {
        // The payment still works; it just won't renew by itself.
        console.warn(`Pro auto-renew unavailable: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { clientSecret, amount: PRO_PRICES[args.period].chargeCents, currency: "eur", autoRenew };
  },
});

export const confirmProPayment = action({
  args: { paymentIntentId: v.string(), period, autoRenew: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ plan: "pro" }> => {
    const user = await signedInUser(ctx);
    if (!PAYMENT_INTENT_ID.test(args.paymentIntentId)) throw fail("BAD_REQUEST", "Unknown payment.");
    const pi = await backendCall(() => fetchPaymentIntent(stripeKey(), args.paymentIntentId));
    if (!pi) throw fail("BAD_REQUEST", "Unknown payment.");
    if (!isProPayment(pi, args.period)) {
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
    await backendCall(() => startSubscription(base, token, process.env, args.period, pi.id));
    let subscription = null;
    try {
      subscription = await fetchSubscription(base, token, process.env);
    } catch {
      /* the verified payment is enough */
    }
    await ctx.runMutation(internal.proPlan.setPro, { userId: user._id, ...(subscription ? { subscription } : {}) });
    // The card is kept for renewals when the payment saved it.
    const savedCard = pi.setup_future_usage === "off_session" && typeof pi.payment_method === "string" && typeof pi.customer === "string";
    await ctx.runMutation(internal.proPlan.saveBilling, {
      userId: user._id,
      period: args.period,
      periodEnd: addPeriod(Date.now(), args.period),
      ...(savedCard ? { customerId: pi.customer as string, paymentMethodId: pi.payment_method as string } : {}),
      autoRenew: savedCard && args.autoRenew !== false,
      clearError: true,
    });
    return { plan: "pro" };
  },
});

// ── Pro ends when the backend says the period is over ──────────────────────
// Pro doesn't renew by itself, so the plan is re-read from
// /user/checkSubscription when the user opens the dashboard (refreshMyPlan,
// at most every 2 minutes) and every hour for every active plan
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
          await applyOrRenew(ctx, userId, token, subscription);
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

const RECHECK_MS = 2 * 60_000;

export const myBackendSession = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("backendSessions").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    const user = await ctx.db.get("users", args.userId);
    return s && user ? { token: s.token, planCheckedAt: s.planCheckedAt ?? 0, legacyStripe: !!user.subscriptionId } : null;
  },
});

export const markPlanChecked = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("backendSessions").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (s) await ctx.db.patch("backendSessions", s._id, { planCheckedAt: Date.now() });
  },
});

// Dashboard open: read the plan from the backend now, so a subscription that
// ended (or was changed on the backend) shows right away.
export const refreshMyPlan = action({
  args: {},
  handler: async (ctx): Promise<{ checked: boolean }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) return { checked: false };
    const session = await ctx.runQuery(internal.proPlan.myBackendSession, { userId: user._id });
    if (!session || session.legacyStripe || Date.now() - session.planCheckedAt < RECHECK_MS) return { checked: false };
    await ctx.runMutation(internal.proPlan.markPlanChecked, { userId: user._id });
    const subscription = await fetchSubscription(backendUrl(process.env), session.token, process.env).catch(() => null);
    if (!subscription) return { checked: false };
    await applyOrRenew(ctx, user._id, session.token, subscription);
    return { checked: true };
  },
});

// ── Auto-renewal ─────────────────────────────────────────────────────────────
// When the backend says the subscription ended and auto-renew is on, the
// saved card is charged for the same period (€35 / €360) without the
// customer, the payment is verified like any other, and /subscription/start
// renews it on the backend. One attempt per period (renewedFor, plus a Stripe
// idempotency key). On failure the customer is told and drops to Free; they
// can pay again from Settings.

const RENEW_WINDOW_MS = 2 * 86_400_000; // don't charge more than 2 days before the period ends

export const billingCustomer = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    (await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique())?.customerId ?? null,
});

export const billingFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique(),
});

export const saveBilling = internalMutation({
  args: {
    userId: v.id("users"),
    period,
    customerId: v.optional(v.string()),
    paymentMethodId: v.optional(v.string()),
    periodEnd: v.optional(v.number()),
    autoRenew: v.optional(v.boolean()),
    clearError: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, clearError, ...fields }) => {
    const row = await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    if (row) await ctx.db.patch("proBilling", row._id, { ...patch, ...(clearError ? { lastError: undefined } : {}), updatedAt: Date.now() });
    else await ctx.db.insert("proBilling", { userId, autoRenew: false, ...patch, period: fields.period, updatedAt: Date.now() });
  },
});

// Claims the renewal of this period once; false if it was already tried.
export const claimRenewal = internalMutation({
  args: { userId: v.id("users"), periodEnd: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!row || row.renewedFor === args.periodEnd) return false;
    await ctx.db.patch("proBilling", row._id, { renewedFor: args.periodEnd, updatedAt: Date.now() });
    return true;
  },
});

export const renewalFailed = internalMutation({
  args: { userId: v.id("users"), message: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (row) await ctx.db.patch("proBilling", row._id, { lastError: args.message.slice(0, 300), updatedAt: Date.now() });
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "billing",
      title: "Your Pro renewal didn't go through",
      body: "We couldn't charge your saved card, so your account is back on Free. Renew Pro from Settings to unlock everything again.",
      link: "/dashboard/settings",
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  },
});

async function renew(ctx: ActionCtx, userId: Id<"users">, token: string): Promise<boolean> {
  const billing = await ctx.runQuery(internal.proPlan.billingFor, { userId });
  if (!billing?.autoRenew || !billing.customerId || !billing.paymentMethodId || !billing.periodEnd) return false;
  if (Date.now() < billing.periodEnd - RENEW_WINDOW_MS) return false;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return false;
  if (!(await ctx.runMutation(internal.proPlan.claimRenewal, { userId, periodEnd: billing.periodEnd }))) return false;

  const p: BillingPeriod = billing.period;
  let pi;
  try {
    pi = await chargeSavedCard(key, {
      customerId: billing.customerId,
      paymentMethodId: billing.paymentMethodId,
      amount: PRO_PRICES[p].chargeCents,
      currency: "eur",
      idempotencyKey: `pro-renew-${userId}-${billing.periodEnd}`,
      meta: { userId, period: p, kind: "pro_renewal" },
    });
  } catch (e) {
    const message = e instanceof StripeApiError ? `${e.code ?? "error"}: ${e.message}` : String(e);
    await ctx.runMutation(internal.proPlan.renewalFailed, { userId, message });
    return false;
  }
  if (!isProPayment(pi, p)) {
    await ctx.runMutation(internal.proPlan.renewalFailed, { userId, message: `payment ${pi.status}` });
    return false;
  }
  await ctx.runMutation(internal.proPlan.claimPayment, { paymentIntentId: pi.id, userId, amount: pi.amount_received ?? pi.amount, currency: pi.currency });
  try {
    await startSubscription(backendUrl(process.env), token, process.env, p, pi.id);
  } catch (e) {
    // Paid but not recorded on the backend: keep Pro here and say so; the
    // next sign-in or support can finish it.
    console.error(`Pro renewal paid (${pi.id}) but /subscription/start failed: ${e instanceof Error ? e.message : e}`);
  }
  await ctx.runMutation(internal.proPlan.setPro, { userId });
  await ctx.runMutation(internal.proPlan.saveBilling, { userId, period: p, periodEnd: addPeriod(Date.now(), p), clearError: true });
  return true;
}

// The backend's answer, but an ended subscription with auto-renew on is
// renewed first.
async function applyOrRenew(ctx: ActionCtx, userId: Id<"users">, token: string, subscription: BackendSubscription): Promise<void> {
  if (!subscription.isSubscribed && (await renew(ctx, userId, token))) return;
  await ctx.runMutation(internal.proPlan.applyBackendPlan, { userId, subscription });
}

// ── Settings: auto-renew status and switch ──────────────────────────────────

export const myBilling = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) return null;
    const row = await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!row) return null;
    return {
      period: row.period,
      periodEnd: row.periodEnd ?? null,
      autoRenew: row.autoRenew,
      canAutoRenew: !!(row.paymentMethodId && row.customerId),
      lastError: row.lastError ?? null,
    };
  },
});

export const setAutoRenew = mutation({
  args: { autoRenew: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw fail("UNAUTHENTICATED", "Please sign in.");
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) throw fail("UNAUTHENTICATED", "Please sign in.");
    const row = await ctx.db.query("proBilling").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!row) throw fail("BAD_REQUEST", "No Pro subscription to change.");
    if (args.autoRenew && !(row.paymentMethodId && row.customerId)) {
      throw fail("NO_CARD", "No saved card yet. Auto-renew turns on with your next Pro payment.");
    }
    await ctx.db.patch("proBilling", row._id, { autoRenew: args.autoRenew, updatedAt: Date.now() });
  },
});
