/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

async function setup(who: Record<string, unknown> = { plan: "pro", subscriptionStatus: "active" }) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...who }));
  await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u2", role: "user", plan: "pro", subscriptionStatus: "active" }));
  return { t, userId, me: t.withIdentity({ subject: "u1|s" }) };
}

// A PaymentIntent as Stripe returns it when we look it up.
function stubIntent(userId: Id<"users"> | string, fields: Record<string, unknown> = {}) {
  const pi = {
    id: "pi_12345678", status: "succeeded", amount: 900, amount_received: 900, currency: "eur",
    metadata: { kind: "remake_seconds", userId, seconds: "30" }, ...fields,
  };
  vi.stubGlobal("fetch", vi.fn(async () => json(pi)));
}

const errorOf = async (p: Promise<unknown>) => ((await p.catch((x) => x)) as { data?: { code?: string; message?: string } }).data;

describe("remakeTopUp.create", () => {
  it("is for Pro", async () => {
    const { me } = await setup({});
    expect(await errorOf(me.action(api.remakeTopUp.create, {}))).toEqual({ code: "LIMIT", message: "Extra seconds come with Pro." });
  });

  it("creates a €9 payment for 30 seconds", async () => {
    const { me, userId } = await setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/search") ? json({ data: [], has_more: false }) : json({ id: "pi_12345678", client_secret: "pi_12345678_secret_abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await me.action(api.remakeTopUp.create, {})).toEqual({ clientSecret: "pi_12345678_secret_abc", seconds: 30, cents: 900 });
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/payment_intents");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("amount")).toBe("900");
    expect(body.get("currency")).toBe("eur");
    expect(body.get("metadata[kind]")).toBe("remake_seconds");
    expect(body.get("metadata[userId]")).toBe(userId);
    expect(body.get("automatic_payment_methods[enabled]")).toBe("true");
    expect(body.get("automatic_payment_methods[allow_redirects]")).toBe("never"); // no return page for packs
  });

  it("needs Stripe set up", async () => {
    const { me } = await setup();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await errorOf(me.action(api.remakeTopUp.create, {}))).toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("remakeTopUp recovery", () => {
  it("adds a paid pack that was never confirmed before starting a new payment", async () => {
    const { me, userId } = await setup();
    const paid = { id: "pi_paidEarlier1", status: "succeeded", amount: 900, amount_received: 900, currency: "eur", metadata: { kind: "remake_seconds", userId, seconds: "30" } };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/payment_intents/search")) return json({ data: [paid], has_more: false });
      return json({ id: "pi_12345678", client_secret: "pi_12345678_secret_abc" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await me.action(api.remakeTopUp.create, {});
    const searchUrl = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(new URL(searchUrl).searchParams.get("query")).toBe(`metadata['userId']:'${userId}' AND metadata['kind']:'remake_seconds' AND status:'succeeded'`);
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ extra: 30 });
  });
});

describe("remakeTopUp.confirm", () => {
  it("adds the seconds once", async () => {
    const { me, userId } = await setup();
    stubIntent(userId);
    expect(await me.action(api.remakeTopUp.confirm, { paymentIntentId: "pi_12345678" })).toEqual({ seconds: 30 });
    expect(await me.action(api.remakeTopUp.confirm, { paymentIntentId: "pi_12345678" })).toEqual({ seconds: 30 });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ extra: 30 });
  });

  it("won't take another user's payment", async () => {
    const { t, me } = await setup();
    const other = await t.run(async (ctx) => (await ctx.db.query("users").collect()).find((u) => u.tokenIdentifier === "u2")!._id);
    stubIntent(other);
    expect(await errorOf(me.action(api.remakeTopUp.confirm, { paymentIntentId: "pi_12345678" }))).toEqual({ code: "BAD_REQUEST", message: "Unknown payment." });
  });

  it("waits for a processing payment", async () => {
    const { me, userId } = await setup();
    stubIntent(userId, { status: "processing" });
    expect(await errorOf(me.action(api.remakeTopUp.confirm, { paymentIntentId: "pi_12345678" }))).toEqual({
      code: "NOT_PAID",
      message: "Your payment is still processing. Once it clears, open Buy again and the seconds are added.",
    });
  });

  it("refuses a payment of the wrong amount", async () => {
    const { me, userId } = await setup();
    stubIntent(userId, { amount: 100, amount_received: 100 });
    expect(await errorOf(me.action(api.remakeTopUp.confirm, { paymentIntentId: "pi_12345678" }))).toEqual({
      code: "NOT_PAID",
      message: "This payment didn't go through.",
    });
  });
});
