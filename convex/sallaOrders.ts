import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptToken, encryptToken } from "./lib/shopifyOAuth";
import {
  AWAITING_STATUS, REFRESH_EARLY_MS, REFRESH_LOCK_MS, SALLA_API, SALLA_TOKEN_URL,
  findStatusIds, statusBody, type SallaStatus,
} from "./lib/sallaApi";

// Writes the COD flow back to Salla (see convex/sallaApp.ts for the webhook).
// A new COD order is held in our "بانتظار التأكيد" sub-status; decide() moves it to
// in_progress or canceled. Convex env: SALLA_CLIENT_ID and SALLA_CLIENT_SECRET (the
// app's keys from the Partner Portal) for token refreshes, SHOPIFY_TOKEN_KEY to read
// the stored tokens.

export const store = internalQuery({
  args: { merchantId: v.number() },
  handler: async (ctx, args) =>
    ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique(),
});

/** Takes the store's refresh lock; null when another refresh holds it. Returns the (encrypted) refresh token. */
export const claimRefresh = internalMutation({
  args: { merchantId: v.number() },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    if (!s) return null;
    const now = Date.now();
    if (s.expiresAt - now > REFRESH_EARLY_MS) return { fresh: true as const };
    if ((s.refreshLockUntil ?? 0) > now) return null;
    await ctx.db.patch("sallaStores", s._id, { refreshLockUntil: now + REFRESH_LOCK_MS });
    return { fresh: false as const, refreshToken: s.refreshToken };
  },
});

export const finishRefresh = internalMutation({
  args: { merchantId: v.number(), accessToken: v.optional(v.string()), refreshToken: v.optional(v.string()), expiresAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    if (!s) return;
    const { accessToken, refreshToken, expiresAt } = args;
    await ctx.db.patch("sallaStores", s._id, {
      refreshLockUntil: undefined,
      ...(accessToken && refreshToken && expiresAt ? { accessToken, refreshToken, expiresAt, updatedAt: Date.now() } : {}),
    });
  },
});

export const saveAwaitingStatus = internalMutation({
  args: { merchantId: v.number(), statusId: v.number() },
  handler: async (ctx, args) => {
    const s = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", args.merchantId)).unique();
    if (s) await ctx.db.patch("sallaStores", s._id, { awaitingStatusId: args.statusId });
  },
});

export const recordOrder = internalMutation({
  args: {
    merchantId: v.number(),
    orderId: v.string(),
    status: v.optional(v.string()),
    heldAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { merchantId, orderId, ...fields }) => {
    const o = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_order", (q) => q.eq("merchantId", merchantId).eq("orderId", orderId))
      .unique();
    // lastError is always written, so a call that worked clears the previous failure.
    if (o) await ctx.db.patch("sallaCodOrders", o._id, { ...fields, lastError: fields.lastError });
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tokenKey(): string {
  const key = process.env.SHOPIFY_TOKEN_KEY?.trim();
  if (!key) throw new Error("SHOPIFY_TOKEN_KEY isn't set, so the Salla tokens can't be read");
  return key;
}

/** A valid access token for the store, refreshing it (once, under the lock) when it's close to running out. */
async function accessToken(ctx: ActionCtx, merchantId: number): Promise<string> {
  const key = tokenKey();
  for (let attempt = 0; attempt < 10; attempt++) {
    const claim = await ctx.runMutation(internal.sallaOrders.claimRefresh, { merchantId });
    if (claim?.fresh) break;
    if (!claim) {
      await sleep(1000); // someone else is refreshing: wait for their new pair
      continue;
    }
    const id = process.env.SALLA_CLIENT_ID?.trim();
    const secret = process.env.SALLA_CLIENT_SECRET?.trim();
    if (!id || !secret) {
      await ctx.runMutation(internal.sallaOrders.finishRefresh, { merchantId });
      throw new Error("SALLA_CLIENT_ID / SALLA_CLIENT_SECRET aren't set, so the Salla token can't be refreshed");
    }
    try {
      const res = await fetch(SALLA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: await decryptToken(claim.refreshToken, key),
          client_id: id,
          client_secret: secret,
        }).toString(),
      });
      const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires?: number; error?: string };
      if (!res.ok || !data.access_token || !data.refresh_token || typeof data.expires !== "number") {
        throw new Error(`Salla token refresh failed (${res.status}${data.error ? `: ${data.error}` : ""})`);
      }
      // Both new tokens are saved before the lock is released: the old refresh token is dead now.
      await ctx.runMutation(internal.sallaOrders.finishRefresh, {
        merchantId,
        accessToken: await encryptToken(data.access_token, key),
        refreshToken: await encryptToken(data.refresh_token, key),
        expiresAt: data.expires * 1000,
      });
      break;
    } catch (e) {
      await ctx.runMutation(internal.sallaOrders.finishRefresh, { merchantId });
      throw e;
    }
  }
  const s = await ctx.runQuery(internal.sallaOrders.store, { merchantId });
  if (!s) throw new Error(`Salla store ${merchantId} isn't installed`);
  return decryptToken(s.accessToken, key);
}

async function sallaFetch<T>(token: string, path: string, init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(`${SALLA_API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(`Salla ${init?.method ?? "GET"} ${path} failed (${res.status}${body.error?.message ? `: ${body.error.message}` : ""})`);
  return body.data as T;
}

/** The store's "بانتظار التأكيد" sub-status id, found or created once and remembered. */
async function awaitingStatusId(ctx: ActionCtx, merchantId: number, token: string): Promise<number> {
  const s = await ctx.runQuery(internal.sallaOrders.store, { merchantId });
  if (s?.awaitingStatusId) return s.awaitingStatusId;
  const { underReviewId, awaitingId } = findStatusIds(await sallaFetch<SallaStatus[]>(token, "/orders/statuses"));
  let id = awaitingId;
  if (!id) {
    if (!underReviewId) throw new Error("The store has no \"under review\" order status to hang ours under");
    id = (await sallaFetch<SallaStatus>(token, "/orders/statuses", {
      method: "POST",
      body: { parent_id: underReviewId, name: AWAITING_STATUS.name, message: AWAITING_STATUS.message, icon: AWAITING_STATUS.icon, is_active: true },
    })).id;
  }
  await ctx.runMutation(internal.sallaOrders.saveAwaitingStatus, { merchantId, statusId: id });
  return id;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Scheduled for each new COD order: hold it in "بانتظار التأكيد" until the customer answers. */
export const hold = internalAction({
  args: { merchantId: v.number(), orderId: v.string() },
  handler: async (ctx, { merchantId, orderId }) => {
    try {
      const token = await accessToken(ctx, merchantId);
      const statusId = await awaitingStatusId(ctx, merchantId, token);
      await sallaFetch(token, `/orders/${orderId}/status`, { method: "POST", body: { status_id: statusId, send_status_sms: false } });
      await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId, orderId, heldAt: Date.now() });
    } catch (e) {
      await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId, orderId, lastError: errorText(e) });
    }
  },
});

/** The customer's answer (WhatsApp buttons later; runnable from the Convex dashboard meanwhile). */
export const decide = internalAction({
  args: { merchantId: v.number(), orderId: v.string(), decision: v.union(v.literal("confirmed"), v.literal("cancelled")) },
  handler: async (ctx, { merchantId, orderId, decision }) => {
    try {
      const token = await accessToken(ctx, merchantId);
      const note = decision === "confirmed" ? "أكد العميل الطلب عبر واتساب" : "ألغى العميل الطلب عبر واتساب";
      await sallaFetch(token, `/orders/${orderId}/status`, { method: "POST", body: statusBody(decision, note) });
      await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId, orderId, status: decision, decidedAt: Date.now() });
      return { ok: true };
    } catch (e) {
      const error = errorText(e);
      await ctx.runMutation(internal.sallaOrders.recordOrder, { merchantId, orderId, lastError: error });
      return { ok: false, error };
    }
  },
});
