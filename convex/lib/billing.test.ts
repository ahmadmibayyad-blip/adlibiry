import { describe, expect, it } from "vitest";
import { effectivePlan, planForPrice, priceIdForVariant } from "./billing";

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
