/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const CLIENT_ID = "istilam-client";
const SECRET = "istilam-secret";
const A = { shop: "shop-a.myshopify.com", key: "aaaaaaaaaa" };
const B = { shop: "shop-b.myshopify.com", key: "bbbbbbbbbb" };

const b64url = (s: string | Uint8Array) =>
  btoa(typeof s === "string" ? s : String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sessionToken(shop: string, over: Record<string, unknown> = {}) {
  const now = Date.now() / 1000;
  const head = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: CLIENT_ID, sub: "1", exp: now + 60, nbf: now - 5, iat: now, jti: "j", sid: "s", ...over,
  }))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(head))))}`;
}

beforeEach(() => {
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_TOKEN_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const s of [A, B]) {
      await ctx.db.insert("shopifyCodShops", {
        shop: s.shop, shopKey: s.key, tokenEnc: "enc:v1:x", tokenExpiresAt: Date.now() + 3_600_000, enabled: true, blockRefusers: false,
        installedAt: 1, updatedAt: 1, plan: { tier: "pro", status: "ACTIVE", test: true }, planCheckedAt: Date.now(),
      });
    }
    await ctx.db.insert("shopifyCodOrders", { shopKey: A.key, orderId: "1", orderName: "#1001", total: 100, currency: "SAR", status: "confirmed", answeredAt: 1, createdAt: Date.now() });
    await ctx.db.insert("shopifyCodOrders", { shopKey: A.key, orderId: "2", orderName: "#1002", total: 50, currency: "SAR", status: "pending", lastError: "Shopify: nope", createdAt: Date.now() });
    await ctx.db.insert("shopifyCodOrders", { shopKey: B.key, orderId: "9", orderName: "#9", status: "confirmed", createdAt: Date.now() });
    await ctx.db.insert("shopifyCodOrders", { shopKey: B.key, orderId: "10", orderName: "#10", status: "pending", holdError: "no_fulfillment_order: x", createdAt: Date.now() });
  });
  return t;
}
const call = async (t: ReturnType<typeof convexTest>, path: string, token: string, body: object = {}) =>
  t.fetch(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Istilam Shopify dashboard", () => {
  it("serves the page only for a shop, framed by that shop and Shopify admin", async () => {
    const t = await setup();
    expect((await t.fetch("/shopify-istilam/app", { method: "GET" })).status).toBe(400);
    expect((await t.fetch("/shopify-istilam/app?shop=evil.com", { method: "GET" })).status).toBe(400);
    const res = await t.fetch(`/shopify-istilam/app?shop=${A.shop}&locale=ar`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(`frame-ancestors https://${A.shop} https://admin.shopify.com`);
    const html = await res.text();
    expect(html).toContain(`<meta name="shopify-api-key" content="${CLIENT_ID}">`);
    expect(html).toContain('dir="rtl"');
    expect(await (await t.fetch(`/shopify-istilam/app?shop=${A.shop}&locale=en-US`, { method: "GET" })).text()).toContain('dir="ltr"');
  });

  it("returns the shop's own numbers and orders only", async () => {
    const t = await setup();
    const res = await call(t, "/shopify-istilam/app/data", await sessionToken(A.shop), { days: 30 });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.stats).toMatchObject({ asked: 2, confirmed: 1, pending: 1, failed: 1 });
    expect(d.recent.map((o: { orderName: string }) => o.orderName).sort()).toEqual(["#1001", "#1002"]);
    expect(d.recent.find((o: { orderId: string }) => o.orderId === "2")).toMatchObject({ errorKind: "shopify" });
    expect(d.plan).toMatchObject({ tier: "pro", active: true, limit: 3000 });
    expect(d.currency).toBe("SAR");
  });

  it("refuses missing, expired and other apps' tokens", async () => {
    const t = await setup();
    expect((await call(t, "/shopify-istilam/app/data", "")).status).toBe(401);
    expect((await call(t, "/shopify-istilam/app/data", await sessionToken(A.shop, { exp: Date.now() / 1000 - 60 }))).status).toBe(401);
    expect((await call(t, "/shopify-istilam/app/data", await sessionToken(A.shop, { aud: "other" }))).status).toBe(401);
  });

  it("saves settings and rejects a bad parcel cost", async () => {
    const t = await setup();
    const tok = await sessionToken(A.shop);
    expect((await call(t, "/shopify-istilam/app/settings", tok, { enabled: false, blockRefusers: true, parcelCost: 20 })).status).toBe(200);
    expect((await call(t, "/shopify-istilam/app/settings", tok, { parcelCost: -5 })).status).toBe(400);
    const shops = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(shops.find((s) => s.shop === A.shop)).toMatchObject({ enabled: false, blockRefusers: true, parcelCost: 20 });
    expect(shops.find((s) => s.shop === B.shop)).toMatchObject({ enabled: true, blockRefusers: false });
  });

  it("makes a CSV link, and a new link stops the old one", async () => {
    const t = await setup();
    const tok = await sessionToken(A.shop);
    const first = (await (await call(t, "/shopify-istilam/app/feed", tok)).json()).feedKey;
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    const csv = await (await t.fetch(`/shopify-istilam/feed/${first}.csv`, { method: "GET" })).text();
    expect(csv).toContain("#1001");
    expect(csv).not.toContain("#9");
    const second = (await (await call(t, "/shopify-istilam/app/feed", tok, { rotate: true })).json()).feedKey;
    expect(second).not.toBe(first);
    expect((await t.fetch(`/shopify-istilam/feed/${first}.csv`, { method: "GET" })).status).toBe(404);
    expect((await t.fetch(`/shopify-istilam/feed/${second}.csv`, { method: "GET" })).status).toBe(200);
  });
});

describe("Istilam Shopify billing", () => {
  type Gql = { op: string; variables: Record<string, unknown> };
  function stubShopify(answers: Record<string, unknown>) {
    const calls: Gql[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
      calls.push({ op, variables });
      return new Response(JSON.stringify({ data: answers[op] ?? {} }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  async function withToken() {
    const t = await setup();
    const { encryptToken } = await import("./lib/shopifyOAuth");
    const tokenEnc = await encryptToken("shpat_x", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("shopifyCodShops").collect()) await ctx.db.patch("shopifyCodShops", s._id, { tokenEnc });
    });
    return t;
  }

  it("creates a test subscription with the trial on a development store", async () => {
    const t = await withToken();
    const calls = stubShopify({
      IstilamShopPlan: { shop: { plan: { partnerDevelopment: true } } },
      IstilamSubscribe: { appSubscriptionCreate: { confirmationUrl: "https://admin.shopify.com/charges/confirm", userErrors: [] } },
    });
    const res = await call(t, "/shopify-istilam/app/billing", await sessionToken(A.shop), { plan: "Confirm Pro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmationUrl: "https://admin.shopify.com/charges/confirm" });
    const sub = calls.find((c) => c.op === "IstilamSubscribe")!;
    expect(sub.variables).toEqual({
      name: "Confirm Pro", returnUrl: `https://${A.shop}/admin/apps/${CLIENT_ID}`, trialDays: 7, test: true,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 27, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
    });
  });

  it("refuses a plan that doesn't exist", async () => {
    const t = await withToken();
    stubShopify({});
    expect((await call(t, "/shopify-istilam/app/billing", await sessionToken(A.shop), { plan: "Free" })).status).toBe(400);
  });

  it("reads the active subscription when the stored plan is old", async () => {
    const t = await withToken();
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("shopifyCodShops").collect()).find((x) => x.shop === A.shop)!;
      await ctx.db.patch("shopifyCodShops", s._id, { planCheckedAt: Date.now() - 60 * 60 * 1000 });
    });
    const created = new Date(Date.now() - 2 * 86400_000).toISOString();
    stubShopify({
      IstilamActiveSubscriptions: { currentAppInstallation: { activeSubscriptions: [
        { id: "gid://shopify/AppSubscription/9", name: "Confirm", status: "ACTIVE", test: false, trialDays: 7, createdAt: created, currentPeriodEnd: "2026-11-27T00:00:00Z" },
      ] } },
    });
    const d = await (await call(t, "/shopify-istilam/app/data", await sessionToken(A.shop))).json();
    expect(d.plan).toMatchObject({ tier: "confirm", name: "Confirm", active: true, limit: 500, test: false });
    expect(d.plan.trialEndsAt).toBe(Date.parse(created) + 7 * 86400_000);

    stubShopify({ IstilamActiveSubscriptions: { currentAppInstallation: { activeSubscriptions: [] } } });
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("shopifyCodShops").collect()).find((x) => x.shop === A.shop)!;
      await ctx.db.patch("shopifyCodShops", s._id, { planCheckedAt: 0 });
    });
    const none = await (await call(t, "/shopify-istilam/app/data", await sessionToken(A.shop))).json();
    expect(none.plan).toMatchObject({ tier: null, active: false });
  });
});

it("shows a hold failure on a pending order", async () => {
  const t = await setup();
  const d = await (await call(t, "/shopify-istilam/app/data", await sessionToken(B.shop))).json();
  expect(d.recent.find((o: { orderId: string }) => o.orderId === "10")).toMatchObject({ errorKind: "no_fulfillment_order" });
});
