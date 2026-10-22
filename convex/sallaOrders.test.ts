/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { decryptToken, encryptToken } from "./lib/shopifyOAuth";

const modules = import.meta.glob("./**/*.ts");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const MERCHANT = 212746149;
const DAY = 24 * 60 * 60 * 1000;

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("SHOPIFY_TOKEN_KEY", KEY);
  vi.stubEnv("SALLA_CLIENT_ID", "client");
  vi.stubEnv("SALLA_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(expiresInMs: number) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("sallaStores", {
      merchantId: MERCHANT,
      accessToken: await encryptToken("access-1", KEY),
      refreshToken: await encryptToken("refresh-1", KEY),
      expiresAt: Date.now() + expiresInMs,
      scope: "orders.read_write",
      installedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("sallaCodOrders", { merchantId: MERCHANT, orderId: "445306537", status: "pending", createdAt: Date.now() });
  });
  return t;
}

type Call = { url: string; method: string; auth: string | null; body: unknown };
function stubSalla(calls: Call[], statuses: object[] = [{ id: 2, name: "بإنتظار المراجعة", type: "original", slug: "under_review" }]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? (url.includes("oauth2") ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)) : undefined;
    calls.push({ url, method, auth: new Headers(init.headers).get("Authorization"), body });
    if (url.includes("oauth2/token")) return json({ access_token: "access-2", refresh_token: "refresh-2", expires: Math.floor(Date.now() / 1000) + 14 * 86400 });
    if (url.endsWith("/orders/statuses") && method === "GET") return json({ status: 200, success: true, data: statuses });
    if (url.endsWith("/orders/statuses")) return json({ status: 200, success: true, data: { id: 77, name: "بانتظار التأكيد", type: "custom", slug: "under_review" } });
    if (url.includes("/status")) return json({ status: 201, success: true, data: { message: "ok", code: 201 } }, 201);
    return json({}, 404);
  });
}

const order = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.query("sallaCodOrders").collect())[0]);

describe("salla order write-back", () => {
  it("creates our sub-status once and holds the order in it", async () => {
    const t = await setup(10 * DAY);
    const calls: Call[] = [];
    stubSalla(calls);
    await t.action(internal.sallaOrders.hold, { merchantId: MERCHANT, orderId: "445306537" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.salla.dev/admin/v2", "")}`)).toEqual([
      "GET /orders/statuses", "POST /orders/statuses", "POST /orders/445306537/status",
    ]);
    expect(calls[1].body).toMatchObject({ parent_id: 2, name: "بانتظار التأكيد" });
    expect(calls[2].body).toEqual({ status_id: 77, send_status_sms: false });
    expect(calls[2].auth).toBe("Bearer access-1");
    expect((await order(t)).heldAt).toBeTypeOf("number");

    calls.length = 0;
    await t.action(internal.sallaOrders.hold, { merchantId: MERCHANT, orderId: "445306537" });
    expect(calls.map((c) => c.method + " " + c.url.split("/v2")[1])).toEqual(["POST /orders/445306537/status"]); // id remembered
  });

  it("reuses the sub-status a store already has", async () => {
    const t = await setup(10 * DAY);
    const calls: Call[] = [];
    stubSalla(calls, [
      { id: 2, name: "بإنتظار المراجعة", type: "original", slug: "under_review" },
      { id: 55, name: "بانتظار التأكيد", type: "custom", slug: "under_review" },
    ]);
    await t.action(internal.sallaOrders.hold, { merchantId: MERCHANT, orderId: "445306537" });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/orders/statuses"))).toBe(false);
    expect(calls[calls.length - 1].body).toEqual({ status_id: 55, send_status_sms: false });
  });

  it("refreshes a token about to expire, saves both new tokens, then cancels with stock restored", async () => {
    const t = await setup(DAY / 2);
    const calls: Call[] = [];
    stubSalla(calls);
    expect(await t.action(internal.sallaOrders.decide, { merchantId: MERCHANT, orderId: "445306537", decision: "cancelled" })).toEqual({ ok: true });
    expect(calls[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "client" });
    expect(calls[1]).toMatchObject({ auth: "Bearer access-2", body: { slug: "canceled", restore_items: true } });
    const s = await t.run(async (ctx) => (await ctx.db.query("sallaStores").collect())[0]);
    expect(await decryptToken(s.refreshToken, KEY)).toBe("refresh-2");
    expect(s.refreshLockUntil).toBeUndefined();
    const o = await order(t);
    expect(o.status).toBe("cancelled");
    expect(o.lastError).toBeUndefined();
  });

  it("keeps the error on the order when Salla refuses", async () => {
    const t = await setup(10 * DAY);
    vi.stubGlobal("fetch", async () => json({ status: 422, success: false, error: { message: "bad status" } }, 422));
    const r = await t.action(internal.sallaOrders.decide, { merchantId: MERCHANT, orderId: "445306537", decision: "confirmed" });
    expect(r.ok).toBe(false);
    expect(await order(t)).toMatchObject({ status: "pending", lastError: expect.stringContaining("bad status") });
  });
});
