/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const MERCHANT = 212746149;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("sallaStores", {
      merchantId: MERCHANT, accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 86400_000,
      scope: "orders.read_write", installedAt: Date.now(), updatedAt: Date.now(), storeName: "متجر الاختبار",
    });
    const base = { merchantId: MERCHANT, currency: "SAR", createdAt: Date.now() - 3600_000 };
    await ctx.db.insert("sallaCodOrders", { ...base, orderId: "1", referenceId: "101", total: 199, status: "confirmed", answeredAt: Date.now() });
    await ctx.db.insert("sallaCodOrders", { ...base, orderId: "2", referenceId: "102", total: 99, status: "cancelled", answeredAt: Date.now() });
    await ctx.db.insert("sallaCodOrders", { ...base, orderId: "3", referenceId: "103", total: 50, status: "pending", lastError: "no mobile" });
    // Another store's order never shows.
    await ctx.db.insert("sallaCodOrders", { ...base, merchantId: 999, orderId: "9", status: "cancelled" });
    // Older than the 30-day window.
    await ctx.db.insert("sallaCodOrders", { ...base, orderId: "4", status: "cancelled", createdAt: Date.now() - 40 * 86400_000 });
  });
  return t;
}

async function signIn(t: ReturnType<typeof convexTest>) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return (JSON.parse(String(init.body)) as { token: string }).token === "good"
      ? json({ status: 200, success: true, data: { merchant_id: MERCHANT, user_id: 7, exp: new Date(Date.now() + 600_000).toISOString() } })
      : json({ status: 401, success: false, error: { message: "Decryption failed" } }, 401);
  });
  const res = await t.fetch("/salla/app/session", { method: "POST", body: JSON.stringify({ token: "good" }) });
  return { res, calls };
}

describe("Dashboard inside Salla", () => {
  it("serves the page framable by Salla only", async () => {
    const t = await setup();
    const res = await t.fetch("/salla/app");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://s.salla.sa");
    const html = await res.text();
    expect(html).toContain("@salla.sa/embedded-sdk@0.2.6");
    // The SDK's message handler reads process.env.NODE_ENV: defined before the SDK loads.
    expect(html.indexOf("window.process")).toBeGreaterThan(-1);
    expect(html.indexOf("window.process")).toBeLessThan(html.indexOf("embedded-sdk@0.2.6"));
  });

  it("checks Salla's token with introspection before giving a session", async () => {
    const t = await setup();
    const { res, calls } = await signIn(t);
    expect(calls[0].url).toBe("https://api.salla.dev/exchange-authority/v1/introspect");
    expect(calls[0].headers["S-Source"]).toBe("1730909299");
    const { session } = await res.json();
    expect(session).toMatch(/^[0-9a-f]{48}$/);

    const bad = await t.fetch("/salla/app/session", { method: "POST", body: JSON.stringify({ token: "forged" }) });
    expect(bad.status).toBe(401);
  });

  it("shows only the signed-in store's numbers", async () => {
    const t = await setup();
    const { session } = await (await signIn(t)).res.json();
    const res = await t.fetch("/salla/app/data", { method: "POST", headers: { authorization: `Bearer ${session}` }, body: "{}" });
    const d = await res.json();
    expect(d.stats).toMatchObject({ asked: 3, confirmed: 1, cancelledByCustomer: 1, pending: 1, failed: 1, saved: 35 });
    expect(d.recent.map((o: { reference: string }) => o.reference).sort()).toEqual(["101", "102", "103"]);
    expect(d.recent.find((o: { reference: string }) => o.reference === "103").error).toBe("no mobile");

    expect((await t.fetch("/salla/app/data", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).status).toBe(401);
  });

  it("saves settings, and a paused store's new orders are left alone", async () => {
    const t = await setup();
    const { session } = await (await signIn(t)).res.json();
    const save = (body: object) => t.fetch("/salla/app/settings", { method: "POST", headers: { authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
    expect((await save({ parcelCost: 5000 })).status).toBe(400);
    expect((await save({ paused: true, parcelCost: 40 })).status).toBe(200);

    const d = await (await t.fetch("/salla/app/data", { method: "POST", headers: { authorization: `Bearer ${session}` }, body: JSON.stringify({ days: 7 }) })).json();
    expect(d.settings).toEqual({ paused: true, parcelCost: 40, blockRefusers: false });
    expect(d.stats.saved).toBe(40);

    await t.mutation(internal.sallaApp.addCodOrder, { merchantId: MERCHANT, orderId: "55" });
    const added = await t.run((ctx) => ctx.db.query("sallaCodOrders").withIndex("by_merchant_order", (q) => q.eq("merchantId", MERCHANT).eq("orderId", "55")).unique());
    expect(added).toBeNull();
  });
});
