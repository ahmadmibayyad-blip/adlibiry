import { describe, expect, it } from "vitest";
import { policyDays, storeChecks, type StoreCheckInput } from "./storeCheck";

// The test store as it was on 2026-10-08: rates that don't match what the store promises.
const base: StoreCheckInput = {
  shopDomain: "chqgx1-t9.myshopify.com",
  currency: "DKK",
  country: "DK",
  plan: { name: "Basic", development: false },
  passwordProtected: false,
  policies: [
    { type: "REFUND_POLICY", body: "<p>Du kan returnere varer inden for 14 dage efter levering.</p>" },
    { type: "PRIVACY_POLICY", body: "privacy" },
    { type: "TERMS_OF_SERVICE", body: "terms" },
    { type: "SHIPPING_POLICY", body: "shipping" },
  ],
  shipping: [
    {
      name: "Danmark",
      countries: ["DK"],
      restOfWorld: false,
      methods: [
        { name: "Ekspress", active: true, description: "1–2 business days", price: 169 },
        { name: "Fri fragt", active: true, price: 0, minTotal: 249 },
        { name: "Standard", active: true, description: "3-5 business days", price: 55 },
      ],
    },
    { name: "EU", countries: ["DE", "SE"], restOfWorld: false, methods: [{ name: "Standard", active: true, price: 299 }] },
  ],
  themeCount: 12,
  facts: { shippingTime: "5–10 business days", returnDays: 30, freeShippingFrom: 299, currency: "DKK" },
  products: [
    { title: "SnuffleMaster", status: "ACTIVE", hasImage: false, bigBrand: false },
    { title: "Roku Streaming Stick", status: "ACTIVE", hasImage: true, bigBrand: true },
    { title: "Brush", status: "ACTIVE", hasImage: true, bigBrand: false },
  ],
};

const byId = (items: ReturnType<typeof storeChecks>) => Object.fromEntries(items.map((i) => [i.id, i]));

describe("Ready to sell?", () => {
  it("finds what the test store gets wrong", () => {
    const items = byId(storeChecks(base));
    expect(items["delivery-time"]).toMatchObject({ status: "fix" });
    expect(items["delivery-time"].detail).toContain("“Ekspress” as 1–2 business days, but your store pages promise 5–10");
    expect(items["free-shipping"]).toMatchObject({ status: "fix" });
    expect(items["free-shipping"].detail).toContain("from 299 DKK, but Shopify gives it from 249 DKK");
    expect(items.returns.detail).toContain("says 14 days, but your store pages say 30 days");
    expect(items["photo:SnuffleMaster"]).toMatchObject({ status: "fix", fixUrl: "https://admin.shopify.com/store/chqgx1-t9/products" });
    expect(items["brand:Roku Streaming Stick"]).toMatchObject({ status: "fix" });
    expect(items.payouts).toMatchObject({ status: "check", fixUrl: "https://admin.shopify.com/store/chqgx1-t9/settings/payments" });
    expect(items["shipping-rates"].status).toBe("ok");
    expect(items.policies.status).toBe("ok");
    expect(items.themes).toBeUndefined();
    // Problems first, fine items last.
    const statuses = storeChecks(base).map((i) => i.status);
    expect(statuses.indexOf("ok")).toBeGreaterThan(statuses.lastIndexOf("fix"));
  });

  it("is all clear for a store that keeps its promises", () => {
    const items = storeChecks({
      ...base,
      policies: base.policies!.map((p) => (p.type === "REFUND_POLICY" ? { ...p, body: "Returns within 30 days." } : p)),
      shipping: [{ name: "DK", countries: ["DK"], restOfWorld: false, methods: [{ name: "Standard", active: true, description: "5–10 business days", price: 49 }, { name: "Free", active: true, price: 0, minTotal: 299 }] }],
      products: [{ title: "Brush", status: "ACTIVE", hasImage: true, bigBrand: false }],
    });
    expect(items.filter((i) => i.status === "fix")).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(["payouts", "delivery-time", "plan", "password", "shipping-rates", "policies"]);
  });

  it("says what to do when it can't see something or the store isn't open", () => {
    const items = byId(storeChecks({ ...base, shipping: null, policies: null, passwordProtected: true, plan: { name: "Development", development: true }, themeCount: 19 }));
    expect(items.shipping.status).toBe("reconnect");
    expect(items.policies.status).toBe("reconnect");
    expect(items.password.status).toBe("fix");
    expect(items.plan.title).toBe("This is a development store");
    expect(items.themes.title).toBe("19 of 20 themes used");
    const missing = byId(storeChecks({ ...base, shipping: [], policies: [] }));
    expect(missing["shipping-rates"].title).toBe("No shipping rates to DK");
    expect(missing.policies.title).toBe("Missing policies: Refund, Privacy, Terms of service, Shipping");
  });

  it("reads day counts from policies in any language", () => {
    expect(policyDays("Returns within 30 days. Refunds in 5-7 days.")).toEqual([30, 7]);
    expect(policyDays("<p>Retur inden for 14 dage</p>")).toEqual([14]);
    expect(policyDays("30-day money-back guarantee")).toEqual([30]);
    expect(policyDays("Rückgabe innerhalb von 30 Tagen")).toEqual([30]);
    expect(policyDays("no numbers")).toEqual([]);
  });
});
