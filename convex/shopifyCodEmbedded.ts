import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { install, NeedsNewSession } from "./shopifyCodAuth";
import { DEFAULT_PARCEL_COST, codStats, errorKind, parseParcelCost } from "./lib/codStats";
import { SHOPIFY_CSV_HEADER, ordersCsv } from "./lib/codCsv";
import { usageMonth, type Tier } from "./lib/codPlans";
import { shopGate } from "./lib/shopifyCod";
import { verifySessionToken } from "./lib/shopifySessionToken";
import { dashboardPage } from "./lib/shopifyCodDashboardPage";

// Istilam's page inside Shopify admin (embedded app). GET /shopify-istilam/app serves it; the page
// calls the POST routes with a fresh App Bridge session token (Authorization: Bearer), checked
// here on every request. A shop without a stored token (first open, reinstall) is installed with
// that same token (token exchange, shopifyCodAuth.ts). /app/feed makes or replaces the shop's
// secret CSV link; GET /shopify-istilam/feed/<key>.csv serves it for Google Sheets / Excel.

const DAY = 24 * 60 * 60 * 1000;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

// A stale session token: App Bridge fetches a new one and retries the request.
const retrySession = () => json({ error: "unauthorized" }, 401, { "x-shopify-retry-invalid-session-request": "1" });

const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

function credentials() {
  const clientId = process.env.SHOPIFY_ISTILAM_CLIENT_ID?.trim();
  const secret = process.env.SHOPIFY_ISTILAM_CLIENT_SECRET?.trim();
  return clientId && secret ? { clientId, secret } : null;
}

/** The shop the request is for (installing it on first use), or the Response to send instead. */
export async function authShop(ctx: ActionCtx, request: Request): Promise<{ shop: string; shopKey: string } | Response> {
  const creds = credentials();
  if (!creds) return json({ error: "not_configured" }, 500);
  const token = bearer(request);
  const claims = token ? await verifySessionToken(token, creds.clientId, creds.secret, Date.now()) : null;
  if (!claims) return retrySession();
  const row = await ctx.runQuery(internal.shopifyCodAuth.shopByDomain, { shop: claims.shop });
  if (row?.tokenEnc && !row.uninstalledAt) return { shop: claims.shop, shopKey: row.shopKey };
  try {
    return { shop: claims.shop, shopKey: await install(ctx, claims.shop, token) };
  } catch (e) {
    if (e instanceof NeedsNewSession) return retrySession();
    console.error("Istilam install failed", claims.shop, e instanceof Error ? e.message : e);
    return json({ error: "install_failed" }, 502);
  }
}

export const data = internalQuery({
  args: { shopKey: v.string(), days: v.number() },
  handler: async (ctx, { shopKey, days }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (!s) return null;
    const orders = await ctx.db
      .query("shopifyCodOrders")
      .withIndex("by_shop_created", (q) => q.eq("shopKey", shopKey).gte("createdAt", Date.now() - days * DAY))
      .order("desc")
      .take(5000);
    const parcelCost = s.parcelCost ?? DEFAULT_PARCEL_COST;
    const usage = await ctx.db
      .query("shopifyCodUsage")
      .withIndex("by_shop_month", (q) => q.eq("shopKey", shopKey).eq("month", usageMonth(Date.now())))
      .unique();
    const gate = shopGate(s.plan ? { ...s.plan, tier: s.plan.tier as Tier } : undefined, Date.now());
    return {
      shop: s.shop,
      shopName: s.name ?? null,
      currency: orders.find((o) => o.currency)?.currency ?? null,
      settings: { enabled: s.enabled, blockRefusers: s.blockRefusers, parcelCost },
      feedKey: s.feedKey ?? null,
      plan: {
        tier: s.plan?.tier ?? null,
        name: s.plan?.name ?? null,
        status: s.plan?.status ?? null,
        trialEndsAt: s.plan?.trialEndsAt ?? null,
        test: s.plan?.test ?? false,
        ...gate,
        sent: usage?.sent ?? 0,
        skipped: usage?.skipped ?? 0,
      },
      planCheckedAt: s.plan?.checkedAt ?? null,
      days,
      stats: codStats(orders, parcelCost),
      recent: orders.slice(0, 25).map((o) => ({
        orderName: o.orderName ?? `#${o.orderId}`,
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
        errorKind: o.status === "pending" && o.lastError ? errorKind(o.lastError) : null,
      })),
    };
  },
});

export const saveSettings = internalMutation({
  args: { shopKey: v.string(), enabled: v.optional(v.boolean()), parcelCost: v.optional(v.number()), blockRefusers: v.optional(v.boolean()) },
  handler: async (ctx, { shopKey, enabled, parcelCost, blockRefusers }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (!s) return "not_installed" as const;
    const patch: { enabled?: boolean; parcelCost?: number; blockRefusers?: boolean; updatedAt: number } = { updatedAt: Date.now() };
    if (enabled !== undefined) patch.enabled = enabled;
    if (blockRefusers !== undefined) patch.blockRefusers = blockRefusers;
    if (parcelCost !== undefined) {
      const cost = parseParcelCost(parcelCost);
      if (cost == null) return "bad_cost" as const;
      patch.parcelCost = cost;
    }
    await ctx.db.patch("shopifyCodShops", s._id, patch);
    return "ok" as const;
  },
});

const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export const feedKey = internalMutation({
  args: { shopKey: v.string(), rotate: v.boolean() },
  handler: async (ctx, { shopKey, rotate }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (!s) return null;
    if (s.feedKey && !rotate) return s.feedKey;
    const key = randomHex(20);
    await ctx.db.patch("shopifyCodShops", s._id, { feedKey: key });
    return key;
  },
});

export const feedOrders = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_feed_key", (q) => q.eq("feedKey", key)).unique();
    if (!s || s.uninstalledAt) return null;
    const orders = await ctx.db.query("shopifyCodOrders").withIndex("by_shop_created", (q) => q.eq("shopKey", s.shopKey)).order("desc").take(5000);
    return orders.map((o) => ({ ...o, referenceId: o.orderName }));
  },
});

export const page = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  if (!SHOP_DOMAIN.test(shop)) return new Response("Open Istilam from your Shopify admin.", { status: 400 });
  const creds = credentials();
  if (!creds) return new Response("Istilam isn't configured yet.", { status: 500 });
  // First open after install: store the shop's token now so webhooks can act before the page calls back.
  const idToken = url.searchParams.get("id_token");
  if (idToken) {
    const claims = await verifySessionToken(idToken, creds.clientId, creds.secret, Date.now());
    if (claims?.shop === shop) {
      const row = await ctx.runQuery(internal.shopifyCodAuth.shopByDomain, { shop });
      if (!row?.tokenEnc || row.uninstalledAt) await install(ctx, shop, idToken).catch(() => null);
    }
  }
  return new Response(dashboardPage({ clientId: creds.clientId, locale: url.searchParams.get("locale") ?? "" }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `frame-ancestors https://${shop} https://admin.shopify.com`,
      "cache-control": "no-store",
    },
  });
});

export const dataRoute = httpAction(async (ctx, request) => {
  const auth = await authShop(ctx, request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { days?: unknown } | null;
  const days = [7, 30, 90].includes(Number(body?.days)) ? Number(body?.days) : 30;
  const d = await ctx.runQuery(internal.shopifyCodEmbedded.data, { shopKey: auth.shopKey, days });
  return d ? json(d) : json({ error: "not_installed" }, 404);
});

export const settingsRoute = httpAction(async (ctx, request) => {
  const auth = await authShop(ctx, request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; parcelCost?: unknown; blockRefusers?: unknown } | null;
  const result = await ctx.runMutation(internal.shopifyCodEmbedded.saveSettings, {
    shopKey: auth.shopKey,
    enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    parcelCost: typeof body?.parcelCost === "number" ? body.parcelCost : undefined,
    blockRefusers: typeof body?.blockRefusers === "boolean" ? body.blockRefusers : undefined,
  });
  return result === "ok" ? json({ ok: true }) : json({ error: result }, 400);
});

export const feedRoute = httpAction(async (ctx, request) => {
  const auth = await authShop(ctx, request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { rotate?: unknown } | null;
  const key = await ctx.runMutation(internal.shopifyCodEmbedded.feedKey, { shopKey: auth.shopKey, rotate: body?.rotate === true });
  return key ? json({ feedKey: key }) : json({ error: "not_installed" }, 404);
});

export const feed = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const key = /\/shopify-istilam\/feed\/([0-9a-f]{40})\.csv$/.exec(url.pathname)?.[1];
  const orders = key ? await ctx.runQuery(internal.shopifyCodEmbedded.feedOrders, { key }) : null;
  if (!orders) return new Response("Not found", { status: 404 });
  const download = url.searchParams.get("download") === "1";
  return new Response(ordersCsv(orders, download, SHOPIFY_CSV_HEADER), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...(download ? { "content-disposition": 'attachment; filename="istilam-cod-orders.csv"' } : {}),
    },
  });
});
