import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { DEFAULT_PARCEL_COST, codStats, errorKind, parseParcelCost, readIntrospect } from "./lib/sallaStats";
import { dashboardPage } from "./lib/sallaDashboardPage";
import { ordersCsv } from "./lib/sallaCsv";

// The merchant's page inside Salla's admin (an embedded page of app 1730909299):
// GET /salla/app serves it, the page posts Salla's short-lived iframe token to
// /salla/app/session, we check it with Salla's introspection and hand back our own
// session id, and /salla/app/data + /salla/app/settings act for that merchant only.
// /salla/app/feed makes (or replaces) the store's secret CSV link; GET /salla/feed/<key>.csv
// serves its orders for Google Sheets' IMPORTDATA (?download=1: with BOM, as a file for Excel).
// Optional env SALLA_APP_ID (default 1730909299).

const APP_ID = () => process.env.SALLA_APP_ID?.trim() || "1730909299";
const SESSION_MS = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const createSession = internalMutation({
  args: { merchantId: v.number(), userId: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const sid = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Date.now() + SESSION_MS;
    await ctx.db.insert("sallaSessions", { sid, ...args, expiresAt });
    // Tidy a few expired sessions on the way.
    for (const old of await ctx.db.query("sallaSessions").order("asc").take(20)) {
      if (old.expiresAt < Date.now()) await ctx.db.delete("sallaSessions", old._id);
    }
    return { sid, expiresAt };
  },
});

async function sessionMerchant(ctx: QueryCtx, sid: string): Promise<number | null> {
  if (!sid) return null;
  const s = await ctx.db.query("sallaSessions").withIndex("by_sid", (q) => q.eq("sid", sid)).unique();
  return s && s.expiresAt > Date.now() ? s.merchantId : null;
}

export const data = internalQuery({
  args: { sid: v.string(), days: v.number() },
  handler: async (ctx, { sid, days }) => {
    const merchantId = await sessionMerchant(ctx, sid);
    if (merchantId == null) return null;
    const store = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", merchantId)).unique();
    const since = Date.now() - days * DAY;
    const orders = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_created", (q) => q.eq("merchantId", merchantId).gte("createdAt", since))
      .order("desc")
      .take(5000);
    const parcelCost = store?.parcelCost ?? DEFAULT_PARCEL_COST;
    return {
      merchantId,
      storeName: store?.storeName ?? null,
      installed: !!store && !store.uninstalledAt,
      settings: { paused: store?.paused ?? false, parcelCost, blockRefusers: store?.blockRefusers ?? false },
      feedKey: store?.feedKey ?? null,
      days,
      stats: codStats(orders, parcelCost),
      recent: orders.slice(0, 25).map((o) => ({
        reference: o.referenceId ?? o.orderId,
        orderId: o.orderId,
        total: o.total ?? null,
        currency: o.currency ?? null,
        status: o.status,
        answered: !!o.answeredAt,
        priorRefusals: o.priorRefusals ?? 0,
        refused: !!o.refusedAt,
        blocked: !!o.blocked,
        address: !!o.addressAt,
        reminders: o.reminders ?? 0,
        createdAt: o.createdAt,
        error: o.status === "pending" ? o.lastError ?? null : null,
        errorKind: o.status === "pending" && o.lastError ? errorKind(o.lastError) : null,
      })),
    };
  },
});

export const saveSettings = internalMutation({
  args: { sid: v.string(), paused: v.optional(v.boolean()), parcelCost: v.optional(v.number()), blockRefusers: v.optional(v.boolean()) },
  handler: async (ctx, { sid, paused, parcelCost, blockRefusers }) => {
    const merchantId = await sessionMerchant(ctx, sid);
    if (merchantId == null) return "unauthorized" as const;
    const store = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", merchantId)).unique();
    if (!store) return "not_installed" as const;
    const patch: { paused?: boolean; parcelCost?: number; blockRefusers?: boolean } = {};
    if (paused !== undefined) patch.paused = paused;
    if (blockRefusers !== undefined) patch.blockRefusers = blockRefusers;
    if (parcelCost !== undefined) {
      const cost = parseParcelCost(parcelCost);
      if (cost == null) return "bad_cost" as const;
      patch.parcelCost = cost;
    }
    await ctx.db.patch("sallaStores", store._id, patch);
    return "ok" as const;
  },
});

const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The store's CSV link key, made on first use; `rotate` replaces it so the old link stops working. */
export const feedKey = internalMutation({
  args: { sid: v.string(), rotate: v.boolean() },
  handler: async (ctx, { sid, rotate }) => {
    const merchantId = await sessionMerchant(ctx, sid);
    if (merchantId == null) return null;
    const store = await ctx.db.query("sallaStores").withIndex("by_merchant", (q) => q.eq("merchantId", merchantId)).unique();
    if (!store) return null;
    if (store.feedKey && !rotate) return store.feedKey;
    const key = randomHex(20);
    await ctx.db.patch("sallaStores", store._id, { feedKey: key });
    return key;
  },
});

export const feedOrders = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const store = await ctx.db.query("sallaStores").withIndex("by_feed_key", (q) => q.eq("feedKey", key)).unique();
    if (!store || store.uninstalledAt) return null;
    return ctx.db
      .query("sallaCodOrders")
      .withIndex("by_merchant_created", (q) => q.eq("merchantId", store.merchantId))
      .order("desc")
      .take(5000);
  },
});

const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

export const page = httpAction(async () =>
  new Response(dashboardPage(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Only Salla's dashboard may frame it.
      "content-security-policy": "frame-ancestors https://s.salla.sa",
      "cache-control": "no-store",
    },
  }),
);

export const session = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "no_token" }, 400);
  const res = await fetch("https://api.salla.dev/exchange-authority/v1/introspect", {
    method: "POST",
    headers: { "content-type": "application/json", "S-Source": APP_ID() },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  const claims = res?.ok ? readIntrospect(await res.json().catch(() => null)) : null;
  if (!claims) return json({ error: "invalid_token" }, 401);
  const s = await ctx.runMutation(internal.sallaEmbedded.createSession, { merchantId: claims.merchantId, userId: claims.userId });
  return json({ session: s.sid, expiresAt: s.expiresAt });
});

export const dataRoute = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as { days?: unknown } | null;
  const days = [7, 30, 90].includes(Number(body?.days)) ? Number(body?.days) : 30;
  const d = await ctx.runQuery(internal.sallaEmbedded.data, { sid: bearer(request), days });
  return d ? json(d) : json({ error: "unauthorized" }, 401);
});

export const settingsRoute = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as { paused?: unknown; parcelCost?: unknown; blockRefusers?: unknown } | null;
  const result = await ctx.runMutation(internal.sallaEmbedded.saveSettings, {
    sid: bearer(request),
    paused: typeof body?.paused === "boolean" ? body.paused : undefined,
    parcelCost: typeof body?.parcelCost === "number" ? body.parcelCost : undefined,
    blockRefusers: typeof body?.blockRefusers === "boolean" ? body.blockRefusers : undefined,
  });
  if (result === "unauthorized") return json({ error: result }, 401);
  return result === "ok" ? json({ ok: true }) : json({ error: result }, 400);
});

export const feedRoute = httpAction(async (ctx, request) => {
  const body = (await request.json().catch(() => null)) as { rotate?: unknown } | null;
  const key = await ctx.runMutation(internal.sallaEmbedded.feedKey, { sid: bearer(request), rotate: body?.rotate === true });
  return key ? json({ feedKey: key }) : json({ error: "unauthorized" }, 401);
});

export const feed = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const key = /\/salla\/feed\/([0-9a-f]{40})\.csv$/.exec(url.pathname)?.[1];
  const orders = key ? await ctx.runQuery(internal.sallaEmbedded.feedOrders, { key }) : null;
  if (!orders) return new Response("Not found", { status: 404 });
  const download = url.searchParams.get("download") === "1";
  return new Response(ordersCsv(orders, download), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...(download ? { "content-disposition": 'attachment; filename="cod-orders.csv"' } : {}),
    },
  });
});
