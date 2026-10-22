/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { signBody } from "./lib/sallaWebhook";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "salla-test-secret";

beforeEach(() => {
  vi.stubEnv("SALLA_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_TOKEN_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
});
afterEach(() => vi.unstubAllEnvs());

async function post(t: ReturnType<typeof convexTest>, payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  return t.fetch("/salla/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-salla-signature": await signBody(body, secret) },
    body,
  });
}

describe("salla webhook", () => {
  it("refuses deliveries Salla didn't sign", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, { event: "app.installed", merchant: 1, data: {} }, "wrong")).status).toBe(401);
  });

  it("stores encrypted tokens, keeps the newest pair, and forgets the store on uninstall", async () => {
    const t = convexTest(schema, modules);
    const auth = (access: string) => ({
      event: "app.store.authorize", merchant: 99,
      data: { access_token: access, refresh_token: `r-${access}`, expires: 1800000000, scope: "orders.read_write", token_type: "bearer" },
    });
    expect((await post(t, auth("first"))).status).toBe(200);
    expect((await post(t, auth("second"))).status).toBe(200);
    const stores = await t.run((ctx) => ctx.db.query("sallaStores").collect());
    expect(stores).toHaveLength(1);
    expect(stores[0].accessToken).toMatch(/^enc:v1:/);
    expect(stores[0].accessToken).not.toContain("second");
    expect(stores[0].expiresAt).toBe(1800000000000);

    await post(t, { event: "order.created", merchant: 99, data: { id: 5, payment_method: "cod" } });
    expect((await post(t, { event: "app.uninstalled", merchant: 99, data: {} })).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("sallaStores").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("sallaCodOrders").collect())).toHaveLength(0);
  });

  it("queues COD orders once, even when Salla sends the same event twice", async () => {
    const t = convexTest(schema, modules);
    const evt = { event: "order.created", merchant: 7, data: { id: 31, reference_id: 1001, payment_method: "cod", amounts: { total: { amount: 99, currency: "SAR" } } } };
    await post(t, evt);
    await post(t, evt);
    await post(t, { ...evt, data: { ...evt.data, id: 32, payment_method: "mada" } });
    const orders = await t.run((ctx) => ctx.db.query("sallaCodOrders").collect());
    expect(orders.map((o) => [o.orderId, o.status, o.total])).toEqual([["31", "pending", 99]]);
  });
});
