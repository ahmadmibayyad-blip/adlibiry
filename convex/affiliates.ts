import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./admin/helpers";
import { stableToken } from "./lib/authIdentity";

// Affiliate program: 30% of every Pro payment a referred user makes, for as
// long as they keep paying. Commissions are payable 30 days after
// the payment (room for refunds); an admin pays them by hand (PayPal / Wise)
// and marks them paid here.
// Flow: adspypro.net/r/<code> → the browser keeps the code (src/lib/referral.ts)
// → after sign-up the dashboard calls claimReferral → proPlan.claimPayment
// calls recordCommission for each payment.

export const COMMISSION_RATE = 0.3;
export const HOLD_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const HOLD_MS = HOLD_DAYS * DAY;
// A referral only counts for a new account, before it has paid anything.
const CLAIM_WINDOW_MS = 7 * DAY;

const CODE = /^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])$/;
const RESERVED = new Set(["admin", "adspy", "adspypro", "adspy-pro", "support", "help", "official", "team", "stripe", "test"]);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const fail = (code: string, message: string) => new ConvexError({ code, message });

/** A code as typed ("My Code ") → "my-code"; null if it can't be a code. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  return CODE.test(code) && !RESERVED.has(code) ? code : null;
}

async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw fail("UNAUTHENTICATED", "Please sign in first.");
  return user;
}

const affiliateOf = (ctx: QueryCtx | MutationCtx, userId: Id<"users">) =>
  ctx.db.query("affiliates").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
const byCode = (ctx: QueryCtx | MutationCtx, code: string) =>
  ctx.db.query("affiliates").withIndex("by_code", (q) => q.eq("code", code)).unique();

type Totals = { pending: number; payable: number; paid: number };

/** Sums in cents: earned but still on hold, earned and payable, already paid. */
export function commissionTotals(rows: Pick<Doc<"affiliateCommissions">, "amount" | "status" | "at">[], now: number): Totals {
  const t: Totals = { pending: 0, payable: 0, paid: 0 };
  for (const r of rows) {
    if (r.status === "paid") t.paid += r.amount;
    else if (r.status === "earned") t[r.at <= now - HOLD_MS ? "payable" : "pending"] += r.amount;
  }
  return t;
}

// Called by proPlan.claimPayment for every new Pro payment (first and renewals).
export async function recordCommission(
  ctx: MutationCtx,
  p: { userId: Id<"users">; paymentIntentId: string; amount: number; currency: string; at: number },
): Promise<void> {
  const ref = await ctx.db.query("referrals").withIndex("by_user", (q) => q.eq("userId", p.userId)).unique();
  if (!ref) return;
  const dup = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", p.paymentIntentId))
    .unique();
  if (dup || !(await ctx.db.get("affiliates", ref.affiliateId))) return;
  if (ref.firstPaidAt === undefined) await ctx.db.patch("referrals", ref._id, { firstPaidAt: p.at });
  await ctx.db.insert("affiliateCommissions", {
    affiliateId: ref.affiliateId,
    userId: p.userId,
    paymentIntentId: p.paymentIntentId,
    paymentAmount: p.amount,
    amount: Math.round(p.amount * COMMISSION_RATE),
    currency: p.currency,
    at: p.at,
    status: "earned",
  });
}

// ── Visitors ─────────────────────────────────────────────────────────────────

// /r/<code> opened (the browser calls this once per code). Unknown codes are ignored.
export const trackClick = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    const aff = code ? await byCode(ctx, code) : null;
    if (aff) await ctx.db.patch("affiliates", aff._id, { clicks: aff.clicks + 1 });
    return null;
  },
});

export type ClaimResult = "claimed" | "already" | "unknown_code" | "own_code" | "not_new";

// The signed-in user came through an affiliate link: link them, once.
export const claimReferral = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<ClaimResult> => {
    const user = await requireUser(ctx);
    if (await ctx.db.query("referrals").withIndex("by_user", (q) => q.eq("userId", user._id)).unique()) return "already";
    const code = normalizeCode(args.code);
    const aff = code ? await byCode(ctx, code) : null;
    if (!aff) return "unknown_code";
    if (aff.userId === user._id) return "own_code";
    const paid = await ctx.db.query("proPayments").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    if (paid || Date.now() - user._creationTime > CLAIM_WINDOW_MS) return "not_new";
    await ctx.db.insert("referrals", { affiliateId: aff._id, userId: user._id, at: Date.now() });
    return "claimed";
  },
});

// ── Affiliates ───────────────────────────────────────────────────────────────

/** A free code from the user's name or email ("ahmad", "ahmad-4821"). */
async function suggestCode(ctx: MutationCtx, user: Doc<"users">): Promise<string> {
  const base = normalizeCode((user.name || user.email?.split("@")[0] || "partner").slice(0, 16)) ?? "partner";
  if (!(await byCode(ctx, base))) return base;
  for (let i = 0; i < 20; i++) {
    const code = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await byCode(ctx, code))) return code;
  }
  throw fail("UNAVAILABLE", "Couldn't find a free code. Please type one.");
}

export const join = mutation({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ code: string }> => {
    const user = await requireUser(ctx);
    const existing = await affiliateOf(ctx, user._id);
    if (existing) return { code: existing.code };
    let code: string;
    if (args.code?.trim()) {
      const typed = normalizeCode(args.code);
      if (!typed) throw fail("BAD_CODE", "Use 3–24 letters, numbers or dashes.");
      if (await byCode(ctx, typed)) throw fail("CODE_TAKEN", "That code is taken. Try another one.");
      code = typed;
    } else {
      code = await suggestCode(ctx, user);
    }
    await ctx.db.insert("affiliates", { userId: user._id, code, clicks: 0, createdAt: Date.now() });
    return { code };
  },
});

export const setPayoutEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const aff = await affiliateOf(ctx, user._id);
    if (!aff) throw fail("NOT_FOUND", "Join the affiliate program first.");
    const email = args.email.trim();
    if (email && !EMAIL.test(email)) throw fail("BAD_EMAIL", "That doesn't look like an email address.");
    await ctx.db.patch("affiliates", aff._id, { payoutEmail: email || undefined });
    return null;
  },
});

const MAX_ROWS = 5000;

async function statsFor(ctx: QueryCtx, aff: Doc<"affiliates">, now: number) {
  const refs = await ctx.db.query("referrals").withIndex("by_affiliate", (q) => q.eq("affiliateId", aff._id)).take(MAX_ROWS);
  const rows = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_affiliate", (q) => q.eq("affiliateId", aff._id))
    .order("desc")
    .take(MAX_ROWS);
  return {
    clicks: aff.clicks,
    signups: refs.length,
    paying: refs.filter((r) => r.firstPaidAt !== undefined).length,
    ...commissionTotals(rows, now),
    rows,
  };
}

// The Settings → Affiliate panel. null = not joined yet.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const aff = await affiliateOf(ctx, user._id);
    if (!aff) return null;
    const now = Date.now();
    const { rows, ...stats } = await statsFor(ctx, aff, now);
    return {
      code: aff.code,
      payoutEmail: aff.payoutEmail ?? "",
      ...stats,
      // No names or emails of referred users, only the money.
      recent: rows.slice(0, 10).map((r) => ({
        at: r.at,
        amount: r.amount,
        currency: r.currency,
        status: r.status === "earned" ? (r.at <= now - HOLD_MS ? "payable" : "pending") : r.status,
      })),
    };
  },
});

// ── Admin ────────────────────────────────────────────────────────────────────

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const affs = await ctx.db.query("affiliates").order("desc").take(500);
    const out = [];
    for (const aff of affs) {
      const { rows: _rows, ...stats } = await statsFor(ctx, aff, now);
      const user = await ctx.db.get("users", aff.userId);
      out.push({ _id: aff._id, code: aff.code, email: user?.email ?? "", payoutEmail: aff.payoutEmail ?? "", ...stats });
    }
    return out.sort((a, b) => b.payable - a.payable || b.signups - a.signups);
  },
});

// After paying an affiliate by hand: every payable commission becomes paid.
export const markPaid = mutation({
  args: { affiliateId: v.id("affiliates") },
  handler: async (ctx, args): Promise<{ count: number; amount: number }> => {
    await requireAdmin(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_affiliate", (q) => q.eq("affiliateId", args.affiliateId))
      .take(MAX_ROWS);
    let count = 0;
    let amount = 0;
    for (const r of rows) {
      if (r.status !== "earned" || r.at > now - HOLD_MS) continue;
      await ctx.db.patch("affiliateCommissions", r._id, { status: "paid", paidAt: now });
      count++;
      amount += r.amount;
    }
    return { count, amount };
  },
});

// A refunded payment: its commission (if any, and not paid yet) is cancelled.
export const voidForPayment = mutation({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId.trim()))
      .unique();
    if (!row || row.status !== "earned") return false;
    await ctx.db.patch("affiliateCommissions", row._id, { status: "void" });
    return true;
  },
});
