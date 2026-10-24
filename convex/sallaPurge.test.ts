/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

it("removes phone hashes after 90 days and old rows after a year", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const order = { merchantId: 1, status: "confirmed", phoneHash: "h", waMessageId: "wamid.1", lastError: "x" };
    await ctx.db.insert("sallaCodOrders", { ...order, orderId: "new", createdAt: now - 10 * DAY });
    await ctx.db.insert("sallaCodOrders", { ...order, orderId: "old", createdAt: now - 100 * DAY });
    await ctx.db.insert("sallaCodOrders", { ...order, orderId: "ancient", createdAt: now - 400 * DAY });
    await ctx.db.insert("sallaRefusers", { merchantId: 1, phoneHash: "a", refusals: 1, lastAt: now - 10 * DAY });
    await ctx.db.insert("sallaRefusers", { merchantId: 1, phoneHash: "b", refusals: 2, lastAt: now - 400 * DAY });
    await ctx.db.insert("sallaWebhookEvents", { key: "k1", receivedAt: now - DAY });
    await ctx.db.insert("sallaWebhookEvents", { key: "k2", receivedAt: now - 40 * DAY });
    await ctx.db.insert("sallaSessions", { sid: "s1", merchantId: 1, expiresAt: now + DAY });
    await ctx.db.insert("sallaSessions", { sid: "s2", merchantId: 1, expiresAt: now - 1000 });
  });

  await t.mutation(internal.sallaPurge.run, {});
  const orders = await t.run((ctx) => ctx.db.query("sallaCodOrders").collect());
  expect(orders.map((o) => [o.orderId, o.phoneHash ?? null, o.waMessageId ?? null, o.lastError ?? null, o.status])).toEqual([
    ["new", "h", "wamid.1", "x", "confirmed"],
    ["old", null, null, null, "confirmed"],
  ]);
  expect((await t.run((ctx) => ctx.db.query("sallaRefusers").collect())).map((r) => r.phoneHash)).toEqual(["a"]);
  expect((await t.run((ctx) => ctx.db.query("sallaWebhookEvents").collect())).map((k) => k.key)).toEqual(["k1"]);
  expect((await t.run((ctx) => ctx.db.query("sallaSessions").collect())).map((s) => s.sid)).toEqual(["s1"]);

  // A second run has nothing left to do.
  expect(await t.mutation(internal.sallaPurge.run, {})).toEqual({ scrubbed: 0, deleted: 0, refusers: 0, keys: 0, sessions: 0 });
});
