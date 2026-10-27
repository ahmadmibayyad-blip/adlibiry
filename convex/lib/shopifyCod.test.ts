import { describe, expect, it } from "vitest";
import { codOrderFromWebhook, ISTILAM_API_VERSION, isCodOrder, pickPhone, SHOPIFY_PLANS, shopGate, tierForPlanName, waNumberFrom } from "./shopifyCod";
import appToml from "../../shopify-istilam/shopify.app.toml?raw";
import { GRACE_MS } from "./codPlans";

describe("isCodOrder", () => {
  it("takes pending orders paid with a cash-on-delivery gateway", () => {
    expect(isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"], financial_status: "pending" })).toBe(true);
    expect(isCodOrder({ payment_gateway_names: ["الدفع عند الاستلام"], financial_status: "pending" })).toBe(true);
    expect(isCodOrder({ payment_gateway_names: ["COD"], financial_status: "pending" })).toBe(true);
  });
  it("leaves card, paid and look-alike orders alone", () => {
    expect(isCodOrder({ payment_gateway_names: ["shopify_payments"], financial_status: "pending" })).toBe(false);
    expect(isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"], financial_status: "paid" })).toBe(false);
    expect(isCodOrder({ payment_gateway_names: ["Codex Pay"], financial_status: "pending" })).toBe(false);
    expect(isCodOrder({ financial_status: "pending" })).toBe(false);
  });
});

describe("codOrderFromWebhook", () => {
  it("reads id, name and total of a COD order", () => {
    expect(codOrderFromWebhook({
      id: 5512345678901, name: "#1001", total_price: "199.00", currency: "SAR",
      payment_gateway_names: ["Cash on Delivery (COD)"], financial_status: "pending",
    })).toEqual({ orderId: "5512345678901", orderName: "#1001", total: 199, currency: "SAR" });
  });
  it("is null for other orders and missing ids", () => {
    expect(codOrderFromWebhook({ id: 1, payment_gateway_names: ["shopify_payments"], financial_status: "pending" })).toBeNull();
    expect(codOrderFromWebhook({ payment_gateway_names: ["COD"], financial_status: "pending" })).toBeNull();
  });
});

describe("waNumberFrom", () => {
  it("adds the country's code to local numbers", () => {
    expect(waNumberFrom("0555123456", "SA")).toBe("966555123456");
    expect(waNumberFrom("50 123 4567", "AE")).toBe("971501234567");
  });
  it("keeps an explicit international prefix over the country", () => {
    expect(waNumberFrom("+966 55 512 3456", "SA")).toBe("966555123456");
    expect(waNumberFrom("00966555123456", "DK")).toBe("966555123456");
  });
  it("refuses unknown countries and impossible lengths", () => {
    expect(waNumberFrom("55512345", "ZZ")).toBeNull();
    expect(waNumberFrom("12", "SA")).toBeNull();
    expect(waNumberFrom(undefined, "SA")).toBeNull();
  });
});

describe("pickPhone", () => {
  it("prefers shipping, then billing, then the order's own phone", () => {
    expect(pickPhone({ shippingAddress: { phone: "0555123456", countryCodeV2: "SA" }, billingAddress: { phone: "+4571653898" } })).toBe("966555123456");
    expect(pickPhone({ shippingAddress: { phone: null, countryCodeV2: "SA" }, billingAddress: { phone: "+4571653898", countryCodeV2: "DK" } })).toBe("4571653898");
    expect(pickPhone({ shippingAddress: { countryCodeV2: "SA" }, phone: "0555123456" })).toBe("966555123456");
  });
  it("is null when nothing is usable", () => {
    expect(pickPhone({ shippingAddress: null, billingAddress: null, phone: null })).toBeNull();
  });
});

describe("plans", () => {
  it("has the four plans at their prices", () => {
    expect(SHOPIFY_PLANS.map((p) => [p.name, p.amount, p.interval, p.tier])).toEqual([
      ["Confirm", 13, "EVERY_30_DAYS", "confirm"],
      ["Confirm Pro", 27, "EVERY_30_DAYS", "pro"],
      ["Confirm Unlimited", 53, "EVERY_30_DAYS", "bundle"],
      ["Confirm Pro Yearly", 264, "ANNUAL", "pro"],
    ]);
  });
  it("maps plan names to tiers", () => {
    expect(tierForPlanName("Confirm Pro Yearly")).toBe("pro");
    expect(tierForPlanName("Confirm")).toBe("confirm");
    expect(tierForPlanName("Unknown")).toBeNull();
  });
  it("only sends on an active subscription", () => {
    const now = Date.UTC(2026, 9, 27);
    expect(shopGate(undefined, now)).toEqual({ active: false, limit: null });
    expect(shopGate({ tier: "confirm", status: "ACTIVE" }, now)).toEqual({ active: true, limit: 500 });
    expect(shopGate({ tier: "bundle", status: "ACTIVE" }, now)).toEqual({ active: true, limit: null });
    expect(shopGate({ tier: "pro", status: "CANCELLED" }, now).active).toBe(false);
    expect(shopGate({ tier: "pro", status: "ACTIVE", currentPeriodEnd: now - GRACE_MS - 1 }, now).active).toBe(false);
    expect(shopGate({ tier: "pro", status: "ACTIVE", currentPeriodEnd: now - 1000 }, now).active).toBe(true);
  });
});

describe("API version", () => {
  it("is one Shopify still supports, and the app config's webhooks use the same one", () => {
    // Shopify supports each quarterly version for 12 months; App Store review rejects older ones.
    expect(ISTILAM_API_VERSION >= "2026-01").toBe(true);
    expect(appToml).toContain(`api_version = "${ISTILAM_API_VERSION}"`);
  });
});
