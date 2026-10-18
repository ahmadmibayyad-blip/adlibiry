import { v } from "convex/values";
import { internalMutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./admin/helpers";
import { readTokenDebug, tokenWarning, type MetaTokenState } from "./lib/metaAdLibrary";

// When META_ACCESS_TOKEN stops working (lib/metaAdLibrary.ts readTokenDebug).
// Checked at the start of every Meta import run; saved in siteStats
// "metaToken" for Admin → Daily imports, and in the token's last week (or once
// it's dead) every admin gets one in-app alert a day.

const KEY = "metaToken";

/** Asks Meta when the token ends and saves it; never throws. */
export async function checkMetaToken(ctx: ActionCtx, token: string): Promise<MetaTokenState> {
  let state: MetaTokenState;
  try {
    const version = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
    const url = new URL(`https://graph.facebook.com/${version}/debug_token`);
    // A token may inspect itself; it goes in the header for access and in input_token for the subject.
    url.searchParams.set("input_token", token);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    state = readTokenDebug(await res.json().catch(() => null), res.status);
  } catch (e) {
    // Couldn't ask (network): keep what we knew.
    console.warn("Meta token check failed", e);
    return { valid: true, expiresAt: null };
  }
  await ctx.runMutation(internal.metaToken.save, { valid: state.valid, expiresAt: state.expiresAt ?? undefined, error: state.error });
  return state;
}

export const save = internalMutation({
  args: { valid: v.boolean(), expiresAt: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const prev = (doc?.data ?? {}) as { alertedDay?: string };
    const state: MetaTokenState = { valid: args.valid, expiresAt: args.expiresAt ?? null, error: args.error };
    const warn = tokenWarning(state, now);
    const today = new Date(now).toISOString().slice(0, 10);
    let alertedDay = prev.alertedDay;
    if (warn.level !== "ok" && prev.alertedDay !== today) {
      const admins = await ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", "admin")).take(20);
      for (const a of admins) {
        await ctx.db.insert("notifications", {
          userId: a._id,
          type: "admin_alert",
          title: warn.level === "dead" ? "Meta import stopped: token expired" : "Meta token expires soon",
          body: warn.text,
          link: "/dashboard/admin",
          isRead: false,
          createdAt: new Date(now).toISOString(),
        });
      }
      alertedDay = today;
    }
    const data = { checkedAt: now, valid: args.valid, expiresAt: args.expiresAt ?? null, error: args.error ?? null, alertedDay };
    const updatedAt = new Date(now).toISOString();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data, updatedAt });
    else await ctx.db.insert("siteStats", { key: KEY, data, updatedAt });
  },
});

// Admin → Daily imports, under the Meta row.
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    if (!doc) return null;
    const d = doc.data as { checkedAt: number; valid: boolean; expiresAt: number | null; error: string | null };
    return { checkedAt: d.checkedAt, ...tokenWarning({ valid: d.valid, expiresAt: d.expiresAt }, Date.now()) };
  },
});
