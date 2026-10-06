/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { effectivePlan, resultLimit } from "./lib/billing";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("7-day Pro free trial", () => {
  it("gives Pro and every result until it ends", () => {
    const now = Date.now();
    const onTrial = { role: "user", proTrialEndsAt: now + DAY };
    expect(effectivePlan(onTrial, now)).toBe("pro");
    expect(resultLimit(onTrial, now)).toBeNull();
    const ended = { role: "user", proTrialEndsAt: now - 1 };
    expect(effectivePlan(ended, now)).toBe("none");
    expect(resultLimit(ended, now)).toBe(10);
    // A paid plan is never downgraded by an old trial date.
    expect(effectivePlan({ plan: "pro", subscriptionStatus: "active", proTrialEndsAt: now - 1 }, now)).toBe("pro");
  });

  it("starts once per account, needs no card, and runs out after 7 days", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const me = t.withIdentity({ subject: "u1|s" });

    expect(await me.query(api.billing.myTrial, {})).toEqual({ state: "available" });
    const { endsAt } = await me.mutation(api.billing.startProTrial, {});
    expect(endsAt).toBe(Date.now() + 7 * DAY);
    expect(await me.query(api.billing.myPlan, {})).toBe("pro");
    expect(await me.query(api.billing.myResultLimit, {})).toBeNull();
    expect(await me.query(api.billing.myTrial, {})).toEqual({ state: "active", endsAt });

    await expect(me.mutation(api.billing.startProTrial, {})).rejects.toThrow();

    vi.setSystemTime(Date.now() + 7 * DAY + 1);
    expect(await me.query(api.billing.myPlan, {})).toBe("none");
    expect(await me.query(api.billing.myResultLimit, {})).toBe(10);
    expect(await me.query(api.billing.myTrial, {})).toEqual({ state: "used" });
    await expect(me.mutation(api.billing.startProTrial, {})).rejects.toThrow(/already been used/);
  });

  it("isn't offered to paying customers or signed-out visitors", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "p1", role: "user", plan: "pro", subscriptionStatus: "active" }));
    expect(await t.withIdentity({ subject: "p1|s" }).query(api.billing.myTrial, {})).toEqual({ state: "paid" });
    await expect(t.withIdentity({ subject: "p1|s" }).mutation(api.billing.startProTrial, {})).rejects.toThrow(/already have Pro/);
    expect(await t.query(api.billing.myTrial, {})).toEqual({ state: "signedOut" });
  });
});
