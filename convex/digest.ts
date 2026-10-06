import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isDigestDue, type DigestAlert, type DigestWinner } from "./lib/digest";

// Reads and writes for the morning digest (the sending action is
// convex/emailSender.ts, which runs in Node). Hourly, users whose local time
// is 8:00 get today's digest once.

// One page of digest subscribers who are due now.
export const dueRecipients = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), nowMs: v.number() },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("alertPreferences")
      .withIndex("by_digest", (q) => q.eq("emailDigestEnabled", true))
      .paginate({ numItems: 100, cursor: args.cursor });
    const due: { userId: Id<"users">; email: string; niches: string[]; day: string; token?: string }[] = [];
    for (const p of page.page) {
      const user = await ctx.db.get("users", p.userId);
      if (!user?.email) continue;
      const { due: isDue, day } = isDigestDue(args.nowMs, user.timezone, p.lastDigestDay);
      if (isDue) due.push({ userId: user._id, email: user.email, niches: user.niches ?? p.watchedNiches, day, token: p.unsubscribeToken });
    }
    return { due, cursor: page.continueCursor, isDone: page.isDone };
  },
});

// Every current winner with what the digest shows (filtered per user in the action).
export const winnerRows = internalQuery({
  args: {},
  handler: async (ctx): Promise<DigestWinner[]> => {
    const rows = await ctx.db.query("winningProducts").withIndex("by_position").take(1000);
    const out: DigestWinner[] = [];
    for (const r of rows) {
      const p = await ctx.db.get("products", r.productId);
      if (p) out.push({ niche: r.niche, enteredDay: r.enteredDay, score: p.aiScore, productId: p._id, title: p.title, imageUrl: p.imageUrl, category: p.category });
    }
    return out;
  },
});

// The user's unread alerts from the last day, for "Your alerts" in the email.
export const recentAlerts = internalQuery({
  args: { userId: v.id("users"), sinceIso: v.string() },
  handler: async (ctx, args): Promise<DigestAlert[]> => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_read", (q) => q.eq("userId", args.userId).eq("isRead", false))
      .order("desc")
      .take(30);
    return rows.filter((n) => n.createdAt >= args.sinceIso).slice(0, 10).map((n) => ({ title: n.title, body: n.body, link: n.link }));
  },
});

// Sent: remember the local day, and make sure there's an unsubscribe token.
export const markSent = internalMutation({
  args: { userId: v.id("users"), day: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const p = await ctx.db.query("alertPreferences").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!p) return "";
    const token = p.unsubscribeToken ?? crypto.randomUUID();
    await ctx.db.patch("alertPreferences", p._id, { lastDigestDay: args.day, unsubscribeToken: token });
    return token;
  },
});

export const ensureToken = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    const p = await ctx.db.query("alertPreferences").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (!p) return "";
    if (p.unsubscribeToken) return p.unsubscribeToken;
    const token = crypto.randomUUID();
    await ctx.db.patch("alertPreferences", p._id, { unsubscribeToken: token });
    return token;
  },
});

// The unsubscribe link (no sign-in needed: the token is the key). Also used by
// the email's one-click List-Unsubscribe header (convex/http.ts).
export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!/^[0-9a-f-]{36}$/i.test(args.token)) return { ok: false };
    const p = await ctx.db.query("alertPreferences").withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", args.token)).unique();
    if (!p) return { ok: false };
    if (p.emailDigestEnabled) await ctx.db.patch("alertPreferences", p._id, { emailDigestEnabled: false, updatedAt: new Date().toISOString() });
    return { ok: true };
  },
});
