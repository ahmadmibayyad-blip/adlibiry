/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const KEY = "testkey";

type PI = { id: string; status: string; amount: number; amount_received?: number; currency: string };

// Fake AdSpy Pro backend + Stripe.
function fakes() {
  const intents = new Map<string, PI>();
  const started: { token: string; body: Record<string, unknown> }[] = [];
  const payBodies: Record<string, unknown>[] = [];
  let subscribed = false;
  let stale = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (u.host === "api.stripe.com") {
      const pi = intents.get(decodeURIComponent(u.pathname.split("/").pop()!));
      return pi ? reply(200, pi) : reply(404, { error: { message: "No such payment_intent" } });
    }
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    if (!auth.startsWith(KEY)) return reply(401, { message: "Invalid auth secret key" });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.pathname === "/subscription/pay") {
      payBodies.push(body);
      return reply(200, { clientSecret: "pi_test123456_secret_abc" });
    }
    if (u.pathname === "/subscription/start") {
      started.push({ token: auth.slice(KEY.length), body });
      subscribed = true;
      return reply(200, { message: "Subscription started successfully" });
    }
    if (u.pathname === "/user/checkSubscription") {
      if (stale) return reply(404, { message: "Subscription not found for this user", is_subscribed: true, subscribed_plan: "Pro" });
      return reply(subscribed ? 200 : 404, { is_subscribed: subscribed, subscribed_plan: subscribed ? "Pro" : "Free" });
    }
    return reply(404, {});
  });
  return { intents, started, payBodies, fetchMock, expire: () => (subscribed = false), staleExpire: () => (stale = true) };
}

describe("Pro plan payments", () => {
  let f: ReturnType<typeof fakes>;
  beforeEach(() => {
    f = fakes();
    vi.stubGlobal("fetch", f.fetchMock);
    vi.stubEnv("ADSPY_BACKEND_AUTH_KEY", KEY);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const setup = async () => {
    const t = convexTest(schema, modules);
    const mk = async (token: string, backendToken?: string) => {
      const id = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: `${token}@x.com`, role: "user", tokenIdentifier: token });
        if (backendToken) await ctx.db.insert("backendSessions", { userId, token: backendToken, updatedAt: 0 });
        return userId;
      });
      return { id, as: t.withIdentity({ subject: `${token}|s` }) };
    };
    return { t, mk };
  };
  const userOf = (t: ReturnType<typeof convexTest>, id: Id<"users">) => t.run((ctx) => ctx.db.get("users", id));

  it("asks the backend for exactly €35 and needs a backend session", async () => {
    const { mk } = await setup();
    const a = await mk("a", "tok-a");
    expect(await a.as.action(api.proPlan.createProPayment, { period: "monthly" })).toMatchObject({ clientSecret: "pi_test123456_secret_abc", amount: 3500 });
    expect(f.payBodies).toEqual([{ amount: 3500, subscriptionType: "monthly" }]);
    const b = await mk("b");
    await expect(b.as.action(api.proPlan.createProPayment, { period: "monthly" })).rejects.toMatchObject({ data: { code: "SIGN_IN_AGAIN" } });
  });

  it("switches Pro on only for a succeeded €35 payment, once", async () => {
    const { t, mk } = await setup();
    const a = await mk("a", "tok-a");
    const b = await mk("b", "tok-b");
    f.intents.set("pi_unpaid00001", { id: "pi_unpaid00001", status: "requires_payment_method", amount: 3500, currency: "eur" });
    f.intents.set("pi_cheap000001", { id: "pi_cheap000001", status: "succeeded", amount: 50, amount_received: 50, currency: "eur" });
    f.intents.set("pi_paid0000001", { id: "pi_paid0000001", status: "succeeded", amount: 3500, amount_received: 3500, currency: "eur" });

    await expect(a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_unpaid00001", period: "monthly" })).rejects.toMatchObject({ data: { code: "NOT_PAID" } });
    await expect(a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_cheap000001", period: "monthly" })).rejects.toMatchObject({ data: { code: "NOT_PAID" } });
    await expect(a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_missing0001", period: "monthly" })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    expect(f.started).toEqual([]);
    expect(await userOf(t, a.id)).not.toHaveProperty("plan");

    await a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_paid0000001", period: "monthly" });
    expect(f.started).toEqual([{ token: "tok-a", body: { subscriptionType: "monthly", cost: 35, paymentIntentId: "pi_paid0000001" } }]);
    expect(await userOf(t, a.id)).toMatchObject({ plan: "pro", subscriptionStatus: "active" });

    // The same payment can't unlock another account.
    await expect(b.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_paid0000001", period: "monthly" })).rejects.toMatchObject({
      data: { message: "This payment was already used." },
    });
    expect(await userOf(t, b.id)).not.toHaveProperty("plan");
  });

  it("yearly: asks for €30 × 12 = €360, and a monthly payment can't buy a year", async () => {
    const { t, mk } = await setup();
    const a = await mk("a", "tok-a");
    expect(await a.as.action(api.proPlan.createProPayment, { period: "yearly" })).toMatchObject({ amount: 36000 });
    expect(f.payBodies).toEqual([{ amount: 3000, subscriptionType: "yearly" }]);

    f.intents.set("pi_month000001", { id: "pi_month000001", status: "succeeded", amount: 3500, amount_received: 3500, currency: "eur" });
    await expect(a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_month000001", period: "yearly" })).rejects.toMatchObject({
      data: { code: "NOT_PAID" },
    });
    f.intents.set("pi_year0000001", { id: "pi_year0000001", status: "succeeded", amount: 36000, amount_received: 36000, currency: "eur" });
    await a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_year0000001", period: "yearly" });
    expect(f.started).toEqual([{ token: "tok-a", body: { subscriptionType: "yearly", cost: 360, paymentIntentId: "pi_year0000001" } }]);
    expect(await userOf(t, a.id)).toMatchObject({ plan: "pro", subscriptionStatus: "active" });
  });

  it("refuses to take payments when Stripe can't be checked", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { mk } = await setup();
    const a = await mk("a", "tok-a");
    await expect(a.as.action(api.proPlan.createProPayment, { period: "monthly" })).rejects.toMatchObject({ data: { code: "NOT_CONFIGURED" } });
    expect(f.payBodies).toEqual([]);
  });

  it("the daily refresh ends Pro when the backend's month is over", async () => {
    const { t, mk } = await setup();
    const a = await mk("a", "tok-a");
    f.intents.set("pi_paid0000002", { id: "pi_paid0000002", status: "succeeded", amount: 3500, amount_received: 3500, currency: "eur" });
    await a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_paid0000002", period: "monthly" });
    // A user with an old Stripe subscription isn't touched.
    const legacy = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "l@x.com", plan: "agency", subscriptionStatus: "active", subscriptionId: "sub_1" });
      await ctx.db.insert("backendSessions", { userId, token: "tok-l", updatedAt: 0 });
      return userId;
    });

    await t.action(internal.proPlan.refreshPlans, {});
    expect(await userOf(t, a.id)).toMatchObject({ plan: "pro", subscriptionStatus: "active" });
    f.expire();
    await t.action(internal.proPlan.refreshPlans, {});
    expect(await userOf(t, a.id)).toMatchObject({ plan: "none", subscriptionStatus: "canceled" });
    expect(await userOf(t, legacy)).toMatchObject({ plan: "agency", subscriptionStatus: "active" });
  });

  it("opening the dashboard re-reads the plan, and a 404 means Free even if the body still says subscribed", async () => {
    const { t, mk } = await setup();
    const a = await mk("a", "tok-a");
    f.intents.set("pi_paid0000003", { id: "pi_paid0000003", status: "succeeded", amount: 3500, amount_received: 3500, currency: "eur" });
    await a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_paid0000003", period: "monthly" });
    expect(await userOf(t, a.id)).toMatchObject({ plan: "pro" });

    // The backend's subscription ended, but the user row still says is_subscribed: true.
    f.staleExpire();
    expect(await a.as.action(api.proPlan.refreshMyPlan, {})).toEqual({ checked: true });
    expect(await userOf(t, a.id)).toMatchObject({ plan: "none", subscriptionStatus: "canceled" });
    // Checked again within 2 minutes: skipped.
    expect(await a.as.action(api.proPlan.refreshMyPlan, {})).toEqual({ checked: false });
  });
});
