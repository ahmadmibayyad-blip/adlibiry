import { describe, expect, it } from "vitest";
import { GRACE_MS, planEventFrom, planGate, sallaDate, tierFor, usageMonth } from "./sallaPlans";

describe("tierFor", () => {
  it("reads the tier from the monthly price, yearly plans included", () => {
    expect(tierFor(49, 1)).toBe("confirm");
    expect(tierFor(99, 1)).toBe("pro");
    expect(tierFor(199, 1)).toBe("bundle");
    expect(tierFor(490, 12)).toBe("confirm");
    expect(tierFor(990, 12)).toBe("pro");
    expect(tierFor(1990, 12)).toBe("bundle");
    expect(tierFor(0, 0)).toBe("confirm");
  });
});

it("reads Salla's dates as the end of that day in Riyadh", () => {
  expect(sallaDate("2026-11-24")).toBe(Date.parse("2026-11-24T20:59:59Z"));
  expect(sallaDate("2026-11-24 12:31:25")).toBe(Date.parse("2026-11-24T20:59:59Z"));
  expect(sallaDate(null)).toBeUndefined();
  expect(sallaDate("soon")).toBeUndefined();
});

describe("planEventFrom", () => {
  const data = { subscription_id: 657032372, item_type: "plan", plan_name: "Confirm Pro", plan_type: "recurring", plan_period: "1", price: 99, end_date: "2026-11-24", store_type: "live" };

  it("reads a started subscription", () => {
    expect(planEventFrom("app.subscription.started", data)).toEqual({
      kind: "start", trial: false, subscriptionId: "657032372", tier: "pro", planName: "Confirm Pro",
      endsAt: Date.parse("2026-11-24T20:59:59Z"), storeType: "live",
    });
  });
  it("uses renew_date when there's no end_date", () => {
    expect(planEventFrom("app.subscription.renewed", { ...data, end_date: null, renew_date: "2026-12-24" })?.endsAt).toBe(Date.parse("2026-12-24T20:59:59Z"));
  });
  it("marks trials and endings", () => {
    expect(planEventFrom("app.trial.started", { ...data, price: 0 })).toMatchObject({ kind: "start", trial: true, tier: "trial" });
    expect(planEventFrom("app.subscription.canceled", data)).toMatchObject({ kind: "end", trial: false });
    expect(planEventFrom("app.trial.expired", data)).toMatchObject({ kind: "end", trial: true });
  });
  it("skips addons and other events", () => {
    expect(planEventFrom("app.subscription.started", { ...data, item_type: "addon", item_slug: "credits" })).toBeNull();
    expect(planEventFrom("order.created", data)).toBeNull();
  });
});

describe("planGate", () => {
  const now = Date.parse("2026-10-24T10:00:00Z");
  it("doesn't limit stores without a plan, or Salla's test stores", () => {
    expect(planGate(null, now)).toEqual({ limited: false, active: true, limit: null });
    expect(planGate({ tier: "confirm", status: "inactive", storeType: "demo" }, now).limited).toBe(false);
  });
  it("gives each tier its allowance", () => {
    expect(planGate({ tier: "confirm", status: "active", storeType: "live" }, now)).toEqual({ limited: true, active: true, limit: 500 });
    expect(planGate({ tier: "trial", status: "trial", storeType: "live" }, now).limit).toBe(3000);
    expect(planGate({ tier: "bundle", status: "active", storeType: "live" }, now).limit).toBeNull();
  });
  it("stops after the end date and grace, or when inactive", () => {
    const plan = { tier: "pro" as const, status: "active" as const, storeType: "live" };
    expect(planGate({ ...plan, endsAt: now - GRACE_MS + 1000 }, now).active).toBe(true);
    expect(planGate({ ...plan, endsAt: now - GRACE_MS - 1000 }, now).active).toBe(false);
    expect(planGate({ ...plan, status: "inactive" }, now).active).toBe(false);
  });
});

it("counts months in Riyadh time", () => {
  expect(usageMonth(Date.parse("2026-10-31T20:59:00Z"))).toBe("2026-10");
  expect(usageMonth(Date.parse("2026-10-31T21:01:00Z"))).toBe("2026-11");
});
