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
        installedAt: 1, updatedAt: 1, plan: { tier: "pro", status: "ACTIVE", test: true, checkedAt: Date.now() },
      });
    }
    await ctx.db.insert("shopifyCodOrders", { shopKey: A.key, orderId: "1", orderName: "#1001", total: 100, currency: "SAR", status: "confirmed", answeredAt: 1, createdAt: Date.now() });
    await ctx.db.insert("shopifyCodOrders", { shopKey: A.key, orderId: "2", orderName: "#1002", total: 50, currency: "SAR", status: "pending", lastError: "Shopify: nope", createdAt: Date.now() });
    await ctx.db.insert("shopifyCodOrders", { shopKey: B.key, orderId: "9", orderName: "#9", status: "confirmed", createdAt: Date.now() });
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
