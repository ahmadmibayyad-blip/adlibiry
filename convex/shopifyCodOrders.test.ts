/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { encryptToken } from "./lib/shopifyOAuth";

const modules = import.meta.glob("./**/*.ts");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SHOP = "istilam-dev.myshopify.com";
const SHOP_KEY = "k3x9a0b2cq";
const ORDER = "5512345678901";

type Call = { op: string; variables: Record<string, unknown> };
let calls: Call[] = [];
let answers: Record<string, unknown> = {};

const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SHOPIFY_TOKEN_KEY", KEY);
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_ID", "istilam-client");
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_SECRET", "istilam-secret");
  calls = [];
  answers = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ op, variables });
    const a = answers[op];
    return json({ data: typeof a === "function" ? (a as () => unknown)() : a ?? {} });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(order: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  const tokenEnc = await encryptToken("shpat_x", KEY);
  await t.run(async (ctx) => {
    await ctx.db.insert("shopifyCodShops", {
      shop: SHOP, shopKey: SHOP_KEY, tokenEnc, tokenExpiresAt: Date.now() + 3_600_000, enabled: true, blockRefusers: false, installedAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("shopifyCodOrders", { shopKey: SHOP_KEY, orderId: ORDER, orderName: "#1001", status: "pending", createdAt: Date.now(), ...order });
  });
  return t;
}
const row = async (t: ReturnType<typeof convexTest>) => (await t.run((ctx) => ctx.db.query("shopifyCodOrders").collect()))[0];
const ops = () => calls.map((c) => c.op);
const scheduled = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const fo = (id: number, status: string, ours = false) => ({
  id: `gid://shopify/FulfillmentOrder/${id}`, status,
  fulfillmentHolds: ours ? [{ id: `gid://shopify/FulfillmentHold/${id}`, heldByRequestingApp: true }] : [],
});

describe("hold", () => {
  it("holds every open fulfillment order, tags the order and asks the customer", async () => {
    const t = await setup();
    answers.IstilamOrderForHold = { order: { cancelledAt: null, fulfillmentOrders: { nodes: [fo(1, "OPEN"), fo(2, "OPEN"), fo(3, "CLOSED")] } } };
    answers.IstilamHold = { fulfillmentOrderHold: { userErrors: [] } };
    answers.IstilamTagsAdd = { tagsAdd: { userErrors: [] } };
    await t.action(internal.shopifyCodOrders.hold, { shopKey: SHOP_KEY, orderId: ORDER });
    expect(ops()).toEqual(["IstilamOrderForHold", "IstilamHold", "IstilamHold", "IstilamTagsAdd"]);
    expect(calls[1].variables).toEqual({
      id: "gid://shopify/FulfillmentOrder/1",
      hold: { reason: "OTHER", reasonNotes: "Istilam: waiting for the customer's WhatsApp confirmation", handle: "istilam" },
    });
    expect(calls[3].variables).toEqual({ id: `gid://shopify/Order/${ORDER}`, tags: ["istilam:pending"] });
    const o = await row(t);
    expect(o.heldAt).toBeTypeOf("number");
    expect(o.fulfillmentOrderIds).toEqual(["gid://shopify/FulfillmentOrder/1", "gid://shopify/FulfillmentOrder/2"]);
    expect((await scheduled(t)).map((s) => s.name)).toContain("shopifyCodWhatsapp:sendConfirm");
  });

  it("waits once for a fulfillment order, then asks anyway and shows why", async () => {
    const t = await setup();
    answers.IstilamOrderForHold = { order: { cancelledAt: null, fulfillmentOrders: { nodes: [] } } };
    await t.action(internal.shopifyCodOrders.hold, { shopKey: SHOP_KEY, orderId: ORDER });
    let s = await scheduled(t);
    expect(s.map((x) => [x.name, x.args[0].attempt])).toEqual([["shopifyCodOrders:hold", 1]]);
    await t.action(internal.shopifyCodOrders.hold, { shopKey: SHOP_KEY, orderId: ORDER, attempt: 1 });
    expect((await row(t)).lastError).toMatch(/^no_fulfillment_order/);
    s = await scheduled(t);
    expect(s.map((x) => x.name)).toContain("shopifyCodWhatsapp:sendConfirm");
  });

  it("does nothing for an order that's no longer pending or was cancelled in Shopify", async () => {
    const done = await setup({ status: "cancelled" });
    await done.action(internal.shopifyCodOrders.hold, { shopKey: SHOP_KEY, orderId: ORDER });
    expect(calls).toHaveLength(0);
    const t = await setup();
    answers.IstilamOrderForHold = { order: { cancelledAt: "2026-10-27T10:00:00Z", fulfillmentOrders: { nodes: [fo(1, "OPEN")] } } };
    await t.action(internal.shopifyCodOrders.hold, { shopKey: SHOP_KEY, orderId: ORDER });
    expect(ops()).toEqual(["IstilamOrderForHold"]);
    expect(await scheduled(t)).toHaveLength(0);
  });
});

describe("decide", () => {
  it("confirmed: releases only our holds and swaps the tags", async () => {
    const t = await setup({ status: "confirmed" });
    answers.IstilamHolds = { order: { fulfillmentOrders: { nodes: [fo(1, "ON_HOLD", true), fo(2, "ON_HOLD", false)] } } };
    answers.IstilamRelease = { fulfillmentOrderReleaseHold: { userErrors: [] } };
    await t.action(internal.shopifyCodOrders.decide, { shopKey: SHOP_KEY, orderId: ORDER, decision: "confirmed" });
    expect(ops()).toEqual(["IstilamHolds", "IstilamRelease", "IstilamTagsAdd", "IstilamTagsRemove"]);
    expect(calls[1].variables).toEqual({ id: "gid://shopify/FulfillmentOrder/1", holdIds: ["gid://shopify/FulfillmentHold/1"] });
    expect(calls[2].variables.tags).toEqual(["istilam:confirmed"]);
    expect(calls[3].variables.tags).toEqual(["istilam:pending"]);
    const o = await row(t);
    expect(o.decidedAt).toBeTypeOf("number");
    expect(o.releasedOutside).toBeUndefined();
  });

  it("confirmed after the merchant released the hold: notes it and releases nothing", async () => {
    const t = await setup({ status: "confirmed" });
    answers.IstilamHolds = { order: { fulfillmentOrders: { nodes: [fo(1, "OPEN")] } } };
    await t.action(internal.shopifyCodOrders.decide, { shopKey: SHOP_KEY, orderId: ORDER, decision: "confirmed" });
    expect(ops()).not.toContain("IstilamRelease");
    expect((await row(t)).releasedOutside).toBe(true);
  });

  it("cancelled: cancels with restock and no refund or customer email", async () => {
    const t = await setup({ status: "cancelled" });
    answers.IstilamCancel = { orderCancel: { userErrors: [], orderCancelUserErrors: [] } };
    await t.action(internal.shopifyCodOrders.decide, { shopKey: SHOP_KEY, orderId: ORDER, decision: "cancelled", note: "no answer" });
    expect(ops()).toEqual(["IstilamCancel", "IstilamTagsAdd", "IstilamTagsRemove"]);
    expect(calls[0].variables).toEqual({
      orderId: `gid://shopify/Order/${ORDER}`, reason: "CUSTOMER", restock: true, notifyCustomer: false,
      refundMethod: { originalPaymentMethodsRefund: false }, staffNote: "no answer",
    });
    expect(calls[1].variables.tags).toEqual(["istilam:cancelled"]);
    expect((await row(t)).decidedAt).toBeTypeOf("number");
  });

  it("keeps the error when Shopify refuses the cancel", async () => {
    const t = await setup({ status: "cancelled" });
    answers.IstilamCancel = { orderCancel: { userErrors: [], orderCancelUserErrors: [{ message: "Order has already been cancelled" }] } };
    await t.action(internal.shopifyCodOrders.decide, { shopKey: SHOP_KEY, orderId: ORDER, decision: "cancelled" });
    const o = await row(t);
    expect(o.lastError).toBe("Shopify: Order has already been cancelled");
    expect(o.decidedAt).toBeUndefined();
  });
});

describe("notes", () => {
  it("adds the new address on its own line and tags the order", async () => {
    const t = await setup();
    answers.IstilamNote = { order: { note: "Gift wrap" } };
    answers.IstilamNoteUpdate = { orderUpdate: { userErrors: [] } };
    await t.action(internal.shopifyCodOrders.appendNote, { shopKey: SHOP_KEY, orderId: ORDER, line: "عنوان جديد" });
    expect(ops()).toEqual(["IstilamNote", "IstilamNoteUpdate", "IstilamTagsAdd"]);
    expect(calls[1].variables).toEqual({ input: { id: `gid://shopify/Order/${ORDER}`, note: "Gift wrap\nعنوان جديد" } });
    expect(calls[2].variables.tags).toEqual(["istilam:address"]);
  });

  it("releases the hold when the customer can't be asked", async () => {
    const t = await setup();
    answers.IstilamHolds = { order: { fulfillmentOrders: { nodes: [fo(1, "ON_HOLD", true)] } } };
    await t.action(internal.shopifyCodOrders.releaseHold, { shopKey: SHOP_KEY, orderId: ORDER });
    expect(ops()).toEqual(["IstilamHolds", "IstilamRelease", "IstilamTagsRemove"]);
  });
});
