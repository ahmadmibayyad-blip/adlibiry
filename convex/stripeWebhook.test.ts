/// <reference types="vite/client" />
import Stripe from "stripe";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "whsec_test_secret";

function signed(payload: string, secret = SECRET) {
  const stripe = new Stripe("sk_test_dummy");
  return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

const subscriptionEvent = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.created",
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status: "trialing",
      items: { object: "list", data: [{ id: "si_1", price: { id: "price_pro" }, current_period_end: 1_800_000_000 }] },
    },
  },
});

describe("Stripe webhook", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function setup() {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", customerId: "cus_1" });
    });
    return t;
  }

  it("records a correctly signed subscription event", async () => {
    const t = await setup();
    expect(await t.action(internal.commerce.handleWebhook, signed(subscriptionEvent))).toEqual({ ok: true });
    expect(await t.withIdentity({ subject: "u1|session" }).query(api.billing.myPlan, {})).toBe("pro");
  });

  it("rejects an event signed with the wrong secret and changes nothing", async () => {
    const t = await setup();
    const forged = signed(subscriptionEvent, "whsec_wrong");
    expect(await t.action(internal.commerce.handleWebhook, forged)).toEqual({ ok: false, error: "Invalid signature" });
    expect(await t.withIdentity({ subject: "u1|session" }).query(api.billing.myPlan, {})).toBe("none");
  });
});
