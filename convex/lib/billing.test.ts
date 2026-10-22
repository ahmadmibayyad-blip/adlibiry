import { describe, expect, it } from "vitest";
import { byTier, effectivePlan, planForPrice, priceIdForVariant, resultLimit, tierOf } from "./billing";

const env = {
  STRIPE_PRICE_STARTER_MONTHLY: "price_s_m",
  STRIPE_PRICE_PRO_MONTHLY: "price_p_m",
  STRIPE_PRICE_PRO_YEARLY: " price_p_y ",
  STRIPE_PRICE_AGENCY_YEARLY: "price_a_y",
};

describe("billing rules", () => {
  it("maps a Pricing page variant to its Stripe price", () => {
    expect(priceIdForVariant("var_pro_monthly", env)).toBe("price_p_m");
    expect(priceIdForVariant("var_pro_yearly", env)).toBe("price_p_y");
    expect(priceIdForVariant("var_agency_monthly", env)).toBeUndefined(); // not configured
    expect(priceIdForVariant("var_unknown", env)).toBeUndefined();
  });

  it("maps a Stripe price back to its plan", () => {
    expect(planForPrice("price_s_m", env)).toBe("starter");
    expect(planForPrice("price_p_y", env)).toBe("pro");
    expect(planForPrice("price_a_y", env)).toBe("agency");
    expect(planForPrice("price_other", env)).toBe("none");
    expect(planForPrice(undefined, env)).toBe("none");
  });

  it("gives access only while the subscription is in good standing", () => {
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "trialing" })).toBe("pro");
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "active" })).toBe("pro");
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "past_due" })).toBe("pro");
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "canceled" })).toBe("none");
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "incomplete" })).toBe("none");
    expect(effectivePlan({ plan: "pro" })).toBe("none");
    expect(effectivePlan(null)).toBe("none");
  });

  it("gives admins full access without a subscription", () => {
    expect(effectivePlan({ role: "admin" })).toBe("agency");
  });
});

describe("tierOf", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  it("tells free, trial, paid and admin apart", () => {
    expect(tierOf(null, now)).toBe("free");
    expect(tierOf({}, now)).toBe("free");
    expect(tierOf({ proTrialEndsAt: now + 86_400_000 }, now)).toBe("trial");
    expect(tierOf({ proTrialEndsAt: now - 1 }, now)).toBe("free");
    expect(tierOf({ plan: "pro", subscriptionStatus: "trialing" }, now)).toBe("trial");
    expect(tierOf({ plan: "pro", subscriptionStatus: "active", proTrialEndsAt: now + 86_400_000 }, now)).toBe("paid");
    expect(tierOf({ plan: "pro", subscriptionStatus: "past_due" }, now)).toBe("paid");
    expect(tierOf({ plan: "pro", subscriptionStatus: "canceled", proTrialEndsAt: now + 86_400_000 }, now)).toBe("trial");
    expect(tierOf({ role: "admin" }, now)).toBe("admin");
    expect(byTier({ proTrialEndsAt: now + 1 }, { admin: 4, paid: 3, trial: 2, free: 1 }, now)).toBe(2);
  });
});

describe("free Pro from an admin (compProUntil)", () => {
  const now = 1_000_000;
  it("counts as paid Pro until the date, with every result", () => {
    const gift = { plan: "none", compProUntil: now + 1 };
    expect(effectivePlan(gift, now)).toBe("pro");
    expect(tierOf(gift, now)).toBe("paid");
    expect(resultLimit(gift, now)).toBeNull();
    // Even next to a used trial or a backend that says "not subscribed".
    expect(tierOf({ ...gift, proTrialEndsAt: now - 1, subscriptionStatus: "canceled" }, now)).toBe("paid");
  });

  it("ends by itself", () => {
    const over = { compProUntil: now };
    expect(effectivePlan(over, now)).toBe("none");
    expect(tierOf(over, now)).toBe("free");
    expect(resultLimit(over, now)).toBe(10);
  });

  it("lifts a 7-day trial to full Pro", () => {
    expect(tierOf({ proTrialEndsAt: now + 1, compProUntil: now + 1 }, now)).toBe("paid");
  });
});
