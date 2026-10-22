/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    creator: await ctx.db.insert("users", { tokenIdentifier: "creator", role: "user", email: "c@x.dk" }),
    admin: await ctx.db.insert("users", { tokenIdentifier: "admin", role: "admin" }),
  }));
  return { t, ...ids, creatorT: t.withIdentity({ subject: "creator|s" }), adminT: t.withIdentity({ subject: "admin|s" }) };
}

afterEach(() => vi.useRealTimers());

describe("giveFreePro", () => {
  it("only admins can give it", async () => {
    const { creatorT, creator } = await setup();
    await expect(creatorT.mutation(api.users.giveFreePro, { userId: creator })).rejects.toThrow(/Admin/);
  });

  it("gives 30 days of Pro, notifies, extends, and can be removed", async () => {
    const { t, adminT, creatorT, creator } = await setup();
    const start = Date.now();
    vi.useFakeTimers({ now: start });
    const { until } = await adminT.mutation(api.users.giveFreePro, { userId: creator });
    expect(until).toBe(start + 30 * DAY);
    expect(await creatorT.query(api.billing.myPlan, {})).toBe("pro");
    expect(await creatorT.query(api.billing.myResultLimit, {})).toBeNull();
    expect(await creatorT.query(api.billing.myTrial, {})).toEqual({ state: "gift", endsAt: start + 30 * DAY });
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.title)).toEqual(["You have Pro free for 30 days"]);

    // The hourly backend check ("not subscribed") doesn't take it away.
    await t.mutation(internal.proPlan.applyBackendPlan, { userId: creator, subscription: { isSubscribed: false, planName: "" } });
    expect(await creatorT.query(api.billing.myPlan, {})).toBe("pro");

    // Giving more adds to the end date.
    expect((await adminT.mutation(api.users.giveFreePro, { userId: creator, days: 10 })).until).toBe(start + 40 * DAY);

    vi.setSystemTime(start + 41 * DAY);
    expect(await creatorT.query(api.billing.myPlan, {})).toBe("none");

    expect(await adminT.mutation(api.users.giveFreePro, { userId: creator, days: 0 })).toEqual({ until: null });
    await expect(adminT.mutation(api.users.giveFreePro, { userId: creator, days: 400 })).rejects.toThrow(/0–366/);
  });
});
