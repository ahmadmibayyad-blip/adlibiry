/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { commissionTotals, normalizeCode } from "./affiliates";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    partner: await ctx.db.insert("users", { tokenIdentifier: "partner", role: "user", name: "Ahmad Partner" }),
    buyer: await ctx.db.insert("users", { tokenIdentifier: "buyer", role: "user" }),
    admin: await ctx.db.insert("users", { tokenIdentifier: "admin", role: "admin" }),
  }));
  return {
    t,
    ...ids,
    partnerT: t.withIdentity({ subject: "partner|s" }),
    buyerT: t.withIdentity({ subject: "buyer|s" }),
    adminT: t.withIdentity({ subject: "admin|s" }),
  };
}

const pay = (t: ReturnType<typeof convexTest>, userId: Id<"users">, id: string, amount = 3500) =>
  t.mutation(internal.proPlan.claimPayment, { paymentIntentId: id, userId, amount, currency: "eur" });

afterEach(() => vi.useRealTimers());

describe("normalizeCode", () => {
  it("cleans typed codes and refuses bad or reserved ones", () => {
    expect(normalizeCode("  My Code ")).toBe("my-code");
    expect(normalizeCode("a_b__c")).toBe("a-b-c");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("-abc")).toBeNull();
    expect(normalizeCode("ad$py")).toBeNull();
    expect(normalizeCode("AdSpy")).toBeNull();
  });
});

describe("commissionTotals", () => {
  it("splits earned into pending (on hold) and payable", () => {
    const now = 100 * DAY;
    expect(
      commissionTotals(
        [
          { amount: 100, status: "earned", at: now - 31 * DAY },
          { amount: 200, status: "earned", at: now - 2 * DAY },
          { amount: 400, status: "paid", at: now - 60 * DAY },
          { amount: 800, status: "void", at: now - 60 * DAY },
        ],
        now,
      ),
    ).toEqual({ pending: 200, payable: 100, paid: 400 });
  });
});

describe("affiliates", () => {
  it("joins with a code from the name, and refuses a taken one", async () => {
    const { partnerT, buyerT } = await setup();
    expect(await partnerT.mutation(api.affiliates.join, {})).toEqual({ code: "ahmad-partner" });
    // Joining again keeps the same code.
    expect(await partnerT.mutation(api.affiliates.join, { code: "other" })).toEqual({ code: "ahmad-partner" });
    await expect(buyerT.mutation(api.affiliates.join, { code: "Ahmad Partner" })).rejects.toThrow(/taken/);
    await expect(buyerT.mutation(api.affiliates.join, { code: "x" })).rejects.toThrow(/3–24/);
  });

  it("counts clicks and links a new user once, not to their own code", async () => {
    const { partnerT, buyerT } = await setup();
    await partnerT.mutation(api.affiliates.join, { code: "shop-tips" });
    await buyerT.mutation(api.affiliates.trackClick, { code: "SHOP-TIPS" });
    await buyerT.mutation(api.affiliates.trackClick, { code: "nobody" });

    expect(await partnerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" })).toBe("own_code");
    expect(await buyerT.mutation(api.affiliates.claimReferral, { code: "nobody" })).toBe("unknown_code");
    expect(await buyerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" })).toBe("claimed");
    expect(await buyerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" })).toBe("already");

    expect(await partnerT.query(api.affiliates.mine, {})).toMatchObject({ code: "shop-tips", clicks: 1, signups: 1, paying: 0 });
  });

  it("doesn't link accounts that already paid or are older than a week", async () => {
    const { t, partnerT, buyerT, buyer } = await setup();
    await partnerT.mutation(api.affiliates.join, { code: "shop-tips" });
    await pay(t, buyer, "pi_before");
    expect(await buyerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" })).toBe("not_new");

    vi.useFakeTimers({ now: Date.now() + 8 * DAY });
    const late = t.withIdentity({ subject: "admin|s" });
    expect(await late.mutation(api.affiliates.claimReferral, { code: "shop-tips" })).toBe("not_new");
  });

  it("earns 30% of each payment for 12 months after the first one", async () => {
    const { t, partnerT, buyerT, buyer } = await setup();
    await partnerT.mutation(api.affiliates.join, { code: "shop-tips" });
    await buyerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" });

    const start = Date.now();
    vi.useFakeTimers({ now: start });
    await pay(t, buyer, "pi_1"); // €35 → €10.50
    await pay(t, buyer, "pi_1"); // the same payment again: no second commission
    vi.setSystemTime(start + 200 * DAY);
    await pay(t, buyer, "pi_2", 36000); // yearly €360 → €108
    vi.setSystemTime(start + 366 * DAY);
    await pay(t, buyer, "pi_3"); // after the 12 months: nothing

    vi.setSystemTime(start + 210 * DAY);
    const mine = await partnerT.query(api.affiliates.mine, {});
    expect(mine).toMatchObject({ paying: 1, payable: 1050, pending: 10800, paid: 0 });
    expect(mine?.recent.map((r) => [r.amount, r.status])).toEqual([
      [10800, "pending"],
      [1050, "payable"],
    ]);
  });

  it("lets an admin mark payable commissions paid and void a refunded one", async () => {
    const { t, partnerT, buyerT, adminT, buyer } = await setup();
    await partnerT.mutation(api.affiliates.join, { code: "shop-tips" });
    await buyerT.mutation(api.affiliates.claimReferral, { code: "shop-tips" });
    const start = Date.now();
    vi.useFakeTimers({ now: start });
    await pay(t, buyer, "pi_1");
    vi.setSystemTime(start + 40 * DAY);
    await pay(t, buyer, "pi_2");

    await expect(partnerT.query(api.affiliates.adminList, {})).rejects.toThrow(/Admin/);
    const [row] = await adminT.query(api.affiliates.adminList, {});
    expect(row).toMatchObject({ code: "shop-tips", payable: 1050, pending: 1050 });

    expect(await adminT.mutation(api.affiliates.voidForPayment, { paymentIntentId: "pi_2" })).toBe(true);
    expect(await adminT.mutation(api.affiliates.markPaid, { affiliateId: row._id })).toEqual({ count: 1, amount: 1050 });
    expect(await partnerT.query(api.affiliates.mine, {})).toMatchObject({ payable: 0, pending: 0, paid: 1050 });
  });

  it("keeps the payout email, and checks it", async () => {
    const { partnerT } = await setup();
    await expect(partnerT.mutation(api.affiliates.setPayoutEmail, { email: "a@b.co" })).rejects.toThrow(/Join/);
    await partnerT.mutation(api.affiliates.join, {});
    await expect(partnerT.mutation(api.affiliates.setPayoutEmail, { email: "nope" })).rejects.toThrow(/email/);
    await partnerT.mutation(api.affiliates.setPayoutEmail, { email: " pay@partner.dk " });
    expect(await partnerT.query(api.affiliates.mine, {})).toMatchObject({ payoutEmail: "pay@partner.dk" });
  });
});
