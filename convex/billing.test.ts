/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", customerId: "cus_1" });
  });
  return { t, user: t.withIdentity({ subject: "u1|session" }) };
}

describe("Stripe subscription changes update the user's plan", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts on no plan, then follows trial, active and cancel", async () => {
    const { t, user } = await setup();
    expect(await user.query(api.billing.myPlan, {})).toBe("none");

    const change = (status: string) =>
      t.mutation(internal.billing.applySubscription, {
        customerId: "cus_1",
        subscriptionId: "sub_1",
        status,
        priceId: "price_pro",
        currentPeriodEnd: 1_800_000_000,
      });

    expect(await change("trialing")).toEqual({ updated: true });
    expect(await user.query(api.billing.myPlan, {})).toBe("pro");
    await change("active");
    expect(await user.query(api.billing.myPlan, {})).toBe("pro");
    await change("canceled");
    expect(await user.query(api.billing.myPlan, {})).toBe("none");

    const row = await t.run(async (ctx) => await ctx.db.query("users").first());
    expect(row).toMatchObject({ subscriptionId: "sub_1", subscriptionStatus: "canceled", planRenewsAt: 1_800_000_000_000 });
  });

  it("ignores subscriptions for customers it doesn't know", async () => {
    const { t } = await setup();
    expect(
      await t.mutation(internal.billing.applySubscription, { customerId: "cus_other", subscriptionId: "sub_9", status: "active" }),
    ).toEqual({ updated: false });
  });

  it("says signed-out visitors have no plan", async () => {
    const { t } = await setup();
    expect(await t.query(api.billing.myPlan, {})).toBe("none");
  });
});
