import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { DEFAULT_PARCEL_COST, codStats, parseParcelCost, readIntrospect } from "./lib/sallaStats";
import { dashboardPage } from "./lib/sallaDashboardPage";

// The merchant's page inside Salla's admin (an embedded page of app 1730909299):
// GET /salla/app serves it, the page posts Salla's short-lived iframe token to
// /salla/app/session, we check it with Salla's introspection and hand back our own
// session id, and /salla/app/data + /salla/app/settings act for that merchant only.
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
        reminders: o.reminders ?? 0,
        createdAt: o.createdAt,
        error: o.status === "pending" ? o.lastError ?? null : null,
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
