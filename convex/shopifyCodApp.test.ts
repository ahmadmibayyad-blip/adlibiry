/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { usageMonth } from "./lib/codPlans";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "istilam-secret";
const SHOP = "istilam-dev.myshopify.com";
const KEY = "k3x9a0b2cq";

async function hmacB64(body: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
}

let hook = 0;
async function post(t: ReturnType<typeof convexTest>, topic: string, payload: object, opts: { secret?: string; id?: string } = {}) {
  const body = JSON.stringify(payload);
  return t.fetch("/shopify-istilam/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": SHOP,
      "x-shopify-webhook-id": opts.id ?? `wh-${++hook}`,
      "x-shopify-hmac-sha256": await hmacB64(body, opts.secret ?? SECRET),
    },
    body,
  });
}

const cod = (id: number, over: object = {}) => ({
  id, name: `#${1000 + id}`, total_price: "199.00", currency: "SAR",
  payment_gateway_names: ["Cash on Delivery (COD)"], financial_status: "pending", ...over,
});

type Plan = { tier: string; status: string; test: boolean };
async function setup(plan: Plan | null = { tier: "pro", status: "ACTIVE", test: true }) {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("shopifyCodShops", {
    shop: SHOP, shopKey: KEY, tokenEnc: "enc:v1:x", enabled: true, blockRefusers: false,
    installedAt: 1, updatedAt: 1, ...(plan ? { plan } : {}),
  }));
  return t;
}
const orders = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("shopifyCodOrders").collect());
const usage = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("shopifyCodUsage").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Istilam Shopify webhook", () => {
  it("refuses deliveries Shopify didn't sign", async () => {
    const t = await setup();
    expect((await post(t, "orders/create", cod(1), { secret: "wrong" })).status).toBe(401);
    expect(await orders(t)).toHaveLength(0);
  });

  it("queues a COD order once and counts it", async () => {
    const t = await setup();
    expect((await post(t, "orders/create", cod(1), { id: "same" })).status).toBe(200);
    expect((await post(t, "orders/create", cod(1), { id: "same" })).status).toBe(200);
    await post(t, "orders/create", cod(2, { payment_gateway_names: ["shopify_payments"] }));
    const rows = await orders(t);
    expect(rows.map((o) => [o.orderId, o.orderName, o.status, o.total, o.currency])).toEqual([["1", "#1001", "pending", 199, "SAR"]]);
    expect((await usage(t))[0]).toMatchObject({ month: usageMonth(Date.now()), sent: 1, skipped: 0 });
  });

  it("skips orders without an active plan, over the limit or with the app off", async () => {
    const t = await setup(null);
    await post(t, "orders/create", cod(1));
    expect(await orders(t)).toHaveLength(0);
    expect((await usage(t))[0]).toMatchObject({ sent: 0, skipped: 1 });

    const full = await setup({ tier: "confirm", status: "ACTIVE", test: false });
    await full.run((ctx) => ctx.db.insert("shopifyCodUsage", { shopKey: KEY, month: usageMonth(Date.now()), sent: 500, skipped: 0 }));
    await post(full, "orders/create", cod(1));
    expect(await orders(full)).toHaveLength(0);

    const off = await setup();
    await off.run(async (ctx) => {
      const s = (await ctx.db.query("shopifyCodShops").first())!;
      await ctx.db.patch("shopifyCodShops", s._id, { enabled: false });
    });
    await post(off, "orders/create", cod(1));
    expect(await orders(off)).toHaveLength(0);
  });

  it("closes a pending order cancelled in Shopify, and never queues one that arrives already cancelled", async () => {
    const t = await setup();
    await post(t, "orders/create", cod(1));
    await post(t, "orders/cancelled", cod(1, { cancelled_at: "2026-10-27T10:00:00Z" }));
    await post(t, "orders/cancelled", cod(2, { cancelled_at: "2026-10-27T10:00:00Z" }));
    await post(t, "orders/create", cod(2));
    const rows = await orders(t);
    expect(rows.map((o) => [o.orderId, o.status])).toEqual([["1", "cancelled"]]);
    expect(rows[0].decidedAt).toBeTypeOf("number");
  });

  it("remembers numbers that refused a confirmed order", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("shopifyCodOrders", { shopKey: KEY, orderId: "5", status: "confirmed", phoneHash: "h1", createdAt: 1 });
      await ctx.db.insert("shopifyCodOrders", { shopKey: KEY, orderId: "6", status: "cancelled", phoneHash: "h2", createdAt: 1 });
    });
    await post(t, "refunds/create", { id: 77, order_id: 5 });
    await post(t, "refunds/create", { id: 78, order_id: 5 });
    await post(t, "orders/cancelled", cod(6));
    const refusers = await t.run((ctx) => ctx.db.query("shopifyCodRefusers").collect());
    expect(refusers.map((r) => [r.phoneHash, r.refusals])).toEqual([["h1", 1]]);
    expect((await orders(t)).find((o) => o.orderId === "5")?.refusedAt).toBeTypeOf("number");
  });

  it("forgets the shop's data on uninstall and on shop/redact", async () => {
    const t = await setup();
    await post(t, "orders/create", cod(1));
    await t.run((ctx) => ctx.db.insert("shopifyCodRefusers", { shopKey: KEY, phoneHash: "h", refusals: 1, lastAt: 1 }));
    await post(t, "app/uninstalled", { id: 1, domain: SHOP });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await orders(t)).toHaveLength(0);
    expect(await usage(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("shopifyCodRefusers").collect())).toHaveLength(0);
    const [shop] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(shop.tokenEnc).toBeUndefined();
    expect(shop.plan).toBeUndefined();
    expect(shop.uninstalledAt).toBeTypeOf("number");

    expect((await post(t, "shop/redact", { shop_id: 1, shop_domain: SHOP })).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("shopifyCodShops").collect())).toHaveLength(0);
  });

  it("deletes one customer's orders and hashes on customers/redact", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("shopifyCodOrders", { shopKey: KEY, orderId: "5", status: "confirmed", phoneHash: "h1", createdAt: 1 });
      await ctx.db.insert("shopifyCodOrders", { shopKey: KEY, orderId: "6", status: "confirmed", phoneHash: "h2", createdAt: 1 });
      await ctx.db.insert("shopifyCodRefusers", { shopKey: KEY, phoneHash: "h1", refusals: 1, lastAt: 1 });
    });
    await post(t, "customers/redact", { shop_domain: SHOP, customer: { id: 9 }, orders_to_redact: [5] });
    expect((await orders(t)).map((o) => o.orderId)).toEqual(["6"]);
    expect(await t.run((ctx) => ctx.db.query("shopifyCodRefusers").collect())).toHaveLength(0);
    expect((await post(t, "customers/data_request", { shop_domain: SHOP, customer: { id: 9 }, data_request: { id: 3 } })).status).toBe(200);
  });

  it("updates the plan from app_subscriptions/update", async () => {
    const t = await setup(null);
    await post(t, "app_subscriptions/update", {
      app_subscription: { admin_graphql_api_id: "gid://shopify/AppSubscription/1", name: "Confirm", status: "ACTIVE" },
    });
    const [shop] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(shop.plan).toMatchObject({ tier: "confirm", status: "ACTIVE", subscriptionId: "gid://shopify/AppSubscription/1" });
    await post(t, "app_subscriptions/update", { app_subscription: { admin_graphql_api_id: "gid://shopify/AppSubscription/1", name: "Confirm", status: "CANCELLED" } });
    const [after] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(after.plan?.status).toBe("CANCELLED");
    await post(t, "orders/create", cod(3));
    expect(await orders(t)).toHaveLength(0);
    expect((await usage(t))[0]).toMatchObject({ skipped: 1 });
  });
});
