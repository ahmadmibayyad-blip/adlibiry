/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const KEY = "testkey";

type PI = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  customer?: string;
  payment_method?: string;
  setup_future_usage?: string;
};

// Fake AdSpy Pro backend + Stripe.
function fakes() {
  const intents = new Map<string, PI>();
  const started: { token: string; body: Record<string, unknown> }[] = [];
  const payBodies: Record<string, unknown>[] = [];
  const customers: Record<string, string>[] = [];
  const updates: { id: string; form: Record<string, string> }[] = [];
  const charges: { form: Record<string, string>; idempotencyKey?: string }[] = [];
  let subscribed = false;
  let stale = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (u.host === "api.stripe.com") {
      const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      if (init?.method === "POST" && u.pathname === "/v1/customers") {
        customers.push(form);
        return reply(200, { id: `cus_${customers.length}` });
      }
      if (init?.method === "POST" && u.pathname === "/v1/payment_intents") {
        charges.push({ form, idempotencyKey: (init.headers as Record<string, string>)["Idempotency-Key"] });
        if (form.payment_method === "pm_declined") return reply(402, { error: { code: "card_declined", message: "Your card was declined." } });
        const pi: PI = { id: `pi_renew${String(charges.length).padStart(6, "0")}`, status: "succeeded", amount: Number(form.amount), amount_received: Number(form.amount), currency: form.currency };
        intents.set(pi.id, pi);
        return reply(200, pi);
      }
      const id = decodeURIComponent(u.pathname.split("/").pop()!);
      if (init?.method === "POST") {
        // Update before payment: attach customer, keep the card.
        updates.push({ id, form });
        const pi = intents.get(id);
        if (pi) Object.assign(pi, { customer: form.customer, setup_future_usage: form.setup_future_usage });
        return reply(200, pi ?? { id });
      }
      const pi = intents.get(id);
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
  return { intents, started, payBodies, customers, updates, charges, fetchMock, expire: () => (subscribed = false), staleExpire: () => (stale = true) };
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

  describe("auto-renewal", () => {
    // Pay once with auto-renew; returns the user.
    const subscribeWithCard = async (paymentMethod: string) => {
      const { t, mk } = await setup();
      const a = await mk("a", "tok-a");
      expect(await a.as.action(api.proPlan.createProPayment, { period: "monthly", autoRenew: true })).toMatchObject({ autoRenew: true });
      expect(f.customers).toHaveLength(1);
      expect(f.updates).toEqual([{ id: "pi_test123456", form: expect.objectContaining({ customer: "cus_1", setup_future_usage: "off_session" }) }]);
      f.intents.set("pi_test123456", {
        id: "pi_test123456", status: "succeeded", amount: 3500, amount_received: 3500, currency: "eur",
        customer: "cus_1", payment_method: paymentMethod, setup_future_usage: "off_session",
      });
      await a.as.action(api.proPlan.confirmProPayment, { paymentIntentId: "pi_test123456", period: "monthly", autoRenew: true });
      const billing = await a.as.query(api.proPlan.myBilling, {});
      expect(billing).toMatchObject({ period: "monthly", autoRenew: true, canAutoRenew: true });
      expect(billing!.periodEnd).toBeGreaterThan(Date.now() + 27 * 86_400_000);
      return { t, a };
    };
    // Move the paid period's end to now, and end it on the backend.
    const endPeriod = async (t: ReturnType<typeof convexTest>) => {
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("proBilling").collect())[0];
        await ctx.db.patch("proBilling", row._id, { periodEnd: Date.now() });
      });
      f.expire();
    };

    it("charges the saved card when the period ends and renews on the backend, once", async () => {
      const { t, a } = await subscribeWithCard("pm_card");
      f.started.length = 0;
      // Not due yet: the backend says active, nothing is charged.
      await t.action(internal.proPlan.refreshPlans, {});
      expect(f.charges).toEqual([]);

      await endPeriod(t);
      await t.action(internal.proPlan.refreshPlans, {});
      expect(f.charges).toHaveLength(1);
      expect(f.charges[0].form).toMatchObject({ amount: "3500", currency: "eur", customer: "cus_1", payment_method: "pm_card", off_session: "true", confirm: "true" });
      expect(f.charges[0].idempotencyKey).toMatch(/^pro-renew-/);
      expect(f.started).toEqual([{ token: "tok-a", body: { subscriptionType: "monthly", cost: 35, paymentIntentId: "pi_renew000001" } }]);
      expect(await userOf(t, a.id)).toMatchObject({ plan: "pro", subscriptionStatus: "active" });
      expect((await a.as.query(api.proPlan.myBilling, {}))!.periodEnd).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    });

    it("a declined card drops to Free and tells the customer; no retry for the same period", async () => {
      const { t, a } = await subscribeWithCard("pm_declined");
      await endPeriod(t);
      await t.action(internal.proPlan.refreshPlans, {});
      expect(f.charges).toHaveLength(1);
      expect(await userOf(t, a.id)).toMatchObject({ plan: "none" });
      const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
      expect(notes).toMatchObject([{ userId: a.id, type: "billing", link: "/dashboard/settings" }]);
      expect(await a.as.query(api.proPlan.myBilling, {})).toMatchObject({ lastError: expect.stringContaining("card_declined") });
      await a.as.action(api.proPlan.refreshMyPlan, {});
      expect(f.charges).toHaveLength(1);
    });

    it("turning auto-renew off in Settings stops the charge", async () => {
      const { t, a } = await subscribeWithCard("pm_card");
      await a.as.mutation(api.proPlan.setAutoRenew, { autoRenew: false });
      await endPeriod(t);
      await t.action(internal.proPlan.refreshPlans, {});
      expect(f.charges).toEqual([]);
      expect(await userOf(t, a.id)).toMatchObject({ plan: "none" });
    });

    it("never charges early: a backend expiry long before the paid period ends isn't renewed", async () => {
      const { t, a } = await subscribeWithCard("pm_card");
      f.expire(); // e.g. an admin ended it on the backend
      await t.action(internal.proPlan.refreshPlans, {});
      expect(f.charges).toEqual([]);
      expect(await userOf(t, a.id)).toMatchObject({ plan: "none" });
    });
  });
});
