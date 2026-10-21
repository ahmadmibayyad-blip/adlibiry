import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { BackendError, fetchPaymentIntent, type StripePaymentIntent } from "./lib/adspyBackend";
import { tierOf } from "./lib/billing";
import { remakePack } from "./lib/remake";
import { StripeApiError, createPaymentIntent, searchPaymentIntents } from "./lib/stripeApi";

// Extra AI-video seconds for Remake this winner: Pro users buy REMAKE_PACK
// (€9 for 30 s) with Stripe Elements. `create` makes the PaymentIntent here
// (the amount is set on the server); `confirm` checks it with Stripe and adds
// one remakeTopUps row per payment. Same Stripe account as Pro (STRIPE_SECRET_KEY).
// A paid pack whose confirm never ran (tab closed, timeout, a slow bank payment)
// is added the next time the user opens Buy: `create` first asks Stripe for the
// user's succeeded packs and claims any not claimed yet.

const fail = (code: string, message: string) => new ConvexError({ code, message });
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,64}$/;
const KIND = "remake_seconds";

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw fail("NOT_CONFIGURED", "Payments aren't set up yet. Please try again later.");
  return key;
}

const isPack = (pi: StripePaymentIntent, userId: string, cents: number) =>
  pi.metadata?.kind === KIND && pi.metadata.userId === userId && (pi.amount_received ?? pi.amount) === cents && pi.currency === "eur";

/** Claims the user's succeeded, unclaimed packs; Stripe trouble here never blocks a new payment. */
async function recoverPaid(ctx: ActionCtx, key: string, userId: string, pack: { seconds: number; cents: number }): Promise<void> {
  let found: StripePaymentIntent[];
  try {
    found = await searchPaymentIntents(key, `metadata['userId']:'${userId}' AND metadata['kind']:'${KIND}' AND status:'succeeded'`);
  } catch (e) {
    console.warn("Remake top-up recovery: search failed", e instanceof Error ? e.message : e);
    return;
  }
  for (const pi of found) {
    if (pi.status !== "succeeded" || !isPack(pi, userId, pack.cents)) continue;
    await ctx.runMutation(internal.remakeTopUp.claim, {
      paymentIntentId: pi.id,
      userId: userId as Id<"users">,
      seconds: pack.seconds,
      amount: pi.amount_received ?? pi.amount,
      currency: pi.currency,
    });
  }
}

export const create = action({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string; seconds: number; cents: number }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw fail("UNAUTHENTICATED", "Please sign in first.");
    const tier = tierOf(user);
    if (tier !== "paid" && tier !== "admin") throw fail("LIMIT", "Extra seconds come with Pro.");
    const key = stripeKey();
    const pack = remakePack(process.env);
    await recoverPaid(ctx, key, user._id, pack);
    try {
      const pi = await createPaymentIntent(key, {
        amount: pack.cents,
        currency: "eur",
        meta: { kind: KIND, userId: user._id, seconds: pack.seconds },
        // A double click within the same minute reuses the first payment.
        idempotencyKey: `remake-topup-${user._id}-${Math.floor(Date.now() / 60_000)}`,
      });
      return { clientSecret: pi.client_secret, seconds: pack.seconds, cents: pack.cents };
    } catch (e) {
      if (e instanceof StripeApiError) throw fail("PAYMENT_ERROR", "Couldn't start the payment. Try again in a minute.");
      throw e;
    }
  },
});

// One payment adds seconds once, for one user. "ok" again for the same user; "taken" if another used it.
export const claim = internalMutation({
  args: { paymentIntentId: v.string(), userId: v.id("users"), seconds: v.number(), amount: v.number(), currency: v.string() },
  handler: async (ctx, args): Promise<"ok" | "taken"> => {
    const used = await ctx.db.query("remakeTopUps").withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId)).unique();
    if (used) return used.userId === args.userId ? "ok" : "taken";
    await ctx.db.insert("remakeTopUps", { ...args, at: Date.now() });
    return "ok";
  },
});

export const confirm = action({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args): Promise<{ seconds: number }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw fail("UNAUTHENTICATED", "Please sign in first.");
    if (!PAYMENT_INTENT_ID.test(args.paymentIntentId)) throw fail("BAD_REQUEST", "Unknown payment.");
    let pi;
    try {
      pi = await fetchPaymentIntent(stripeKey(), args.paymentIntentId);
    } catch (e) {
      if (e instanceof BackendError) throw fail("PAYMENT_ERROR", e.message);
      throw e;
    }
    if (!pi || pi.metadata?.kind !== KIND || pi.metadata.userId !== user._id) throw fail("BAD_REQUEST", "Unknown payment.");
    const pack = remakePack(process.env);
    const paid = pi.status === "succeeded" && isPack(pi, user._id, pack.cents);
    if (!paid) {
      throw fail(
        "NOT_PAID",
        pi.status === "processing" ? "Your payment is still processing. Once it clears, open Buy again and the seconds are added." : "This payment didn't go through.",
      );
    }
    const claimed = await ctx.runMutation(internal.remakeTopUp.claim, {
      paymentIntentId: pi.id,
      userId: user._id,
      seconds: pack.seconds,
      amount: pi.amount_received ?? pi.amount,
      currency: pi.currency,
    });
    if (claimed === "taken") throw fail("BAD_REQUEST", "This payment was already used.");
    return { seconds: pack.seconds };
  },
});
