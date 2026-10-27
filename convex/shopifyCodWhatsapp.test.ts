/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { encryptToken } from "./lib/shopifyOAuth";
import { signBody } from "./lib/sallaWebhook";
import { AUTO_CANCEL_AFTER_MS, REMINDER_DELAYS_MS, REPLIES, addressNote, phoneHash } from "./lib/whatsapp";

const modules = import.meta.glob("./**/*.ts");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SHOP = "istilam-dev.myshopify.com";
const SHOP_KEY = "k3x9a0b2cq";
const ORDER = "5512345678901";
const PHONE = "966555123456";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are read field by field
type Call = { url: string; op?: string; body: any };
let calls: Call[] = [];
let orderAnswer: Record<string, unknown>;
let holdNodes: unknown[] = [];

const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SHOPIFY_TOKEN_KEY", KEY);
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_ID", "istilam-client");
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_SECRET", "istilam-secret");
  vi.stubEnv("WHATSAPP_TOKEN", "wa-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234");
  vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
  calls = [];
  holdNodes = [];
  orderAnswer = {
    name: "#1001", totalPriceSet: { shopMoney: { amount: "199.0", currencyCode: "SAR" } },
    shippingAddress: { firstName: "Sara", phone: "0555123456", countryCodeV2: "SA" }, billingAddress: null, customer: null,
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.includes("graph.facebook.com")) {
      calls.push({ url, body });
      return json({ messages: [{ id: `wamid.${calls.length}` }] });
    }
    const op = /(?:query|mutation)\s+(\w+)/.exec(body?.query ?? "")?.[1];
    calls.push({ url, op, body });
    if (op === "IstilamOrderForMessage") return json({ data: { order: orderAnswer, shop: { name: "Nordform" } } });
    if (op === "IstilamHolds") return json({ data: { order: { fulfillmentOrders: { nodes: holdNodes } } } });
    return json({ data: {} });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(order: Record<string, unknown> = {}, shop: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  const tokenEnc = await encryptToken("shpat_x", KEY);
  await t.run(async (ctx) => {
    await ctx.db.insert("shopifyCodShops", {
      shop: SHOP, shopKey: SHOP_KEY, tokenEnc, tokenExpiresAt: Date.now() + 3_600_000, enabled: true, blockRefusers: false,
      installedAt: 1, updatedAt: 1, ...shop,
    });
    await ctx.db.insert("shopifyCodOrders", { shopKey: SHOP_KEY, orderId: ORDER, orderName: "#1001", status: "pending", createdAt: Date.now(), ...order });
  });
  return t;
}
const row = async (t: ReturnType<typeof convexTest>) => (await t.run((ctx) => ctx.db.query("shopifyCodOrders").collect()))[0];
const scheduled = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const waCalls = () => calls.filter((c) => c.url.includes("graph.facebook.com"));

async function post(t: ReturnType<typeof convexTest>, body: object) {
  const raw = JSON.stringify(body);
  return t.fetch("/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${await signBody(raw, "app-secret")}` } });
}
let msgId = 0;
const tap = (payload: string, from = PHONE) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.in${++msgId}`, type: "button", button: { payload, text: "x" } }] } }] }],
});
const text = (body: string, from = PHONE) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.in${++msgId}`, type: "text", text: { body } }] } }] }],
});

describe("Istilam Shopify WhatsApp", () => {
  it("sends the template with Shopify payloads and schedules the reminders", async () => {
    const t = await setup();
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 0 });
    const [msg] = waCalls();
    expect(msg.body.to).toBe(PHONE);
    expect(msg.body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Sara", "Nordform", "#1001", "199.0 SAR"]);
    expect(JSON.stringify(msg.body)).toContain(`shp:${SHOP_KEY}:${ORDER}:c`);
    const o = await row(t);
    expect(o).toMatchObject({ waMessageId: "wamid.2", reminders: 0, phoneHash: await phoneHash(PHONE, KEY) });
    expect(JSON.stringify(o)).not.toContain("555123456");
    const s = await scheduled(t);
    expect(s.map((x) => [x.name, x.args[0].reminder])).toEqual([["shopifyCodWhatsapp:sendConfirm", 1]]);
    expect(s[0].scheduledTime - Date.now()).toBe(REMINDER_DELAYS_MS[0]);
    const [shop] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(shop.name).toBe("Nordform");
  });

  it("cancels for lack of an answer after the last reminder", async () => {
    const t = await setup();
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: REMINDER_DELAYS_MS.length });
    const s = await scheduled(t);
    expect(s.map((x) => x.name)).toEqual(["shopifyCodWhatsapp:cancelUnanswered"]);
    expect(s[0].scheduledTime - Date.now()).toBe(AUTO_CANCEL_AFTER_MS);
    await t.mutation(internal.shopifyCodWhatsapp.cancelUnanswered, { shopKey: SHOP_KEY, orderId: ORDER });
    expect((await row(t)).status).toBe("cancelled");
    expect((await scheduled(t)).map((x) => [x.name, x.args[0].decision])).toContainEqual(["shopifyCodOrders:decide", "cancelled"]);
  });

  it("releases the hold when no number can be used", async () => {
    orderAnswer = { ...orderAnswer, shippingAddress: { firstName: "Sara", phone: null, countryCodeV2: "SA" } };
    const t = await setup();
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 0 });
    expect(waCalls()).toHaveLength(0);
    expect((await row(t)).lastError).toMatch(/no usable mobile/);
    expect((await scheduled(t)).map((x) => x.name)).toEqual(["shopifyCodOrders:releaseHold"]);
  });

  it("stops when the order is no longer pending", async () => {
    const t = await setup({ status: "cancelled" });
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 1 });
    expect(calls).toHaveLength(0);
  });

  it("cancels a known refuser's order without asking when the shop says so", async () => {
    const t = await setup({}, { blockRefusers: true });
    await t.run(async (ctx) => ctx.db.insert("shopifyCodRefusers", { shopKey: SHOP_KEY, phoneHash: await phoneHash(PHONE, KEY), refusals: 2, lastAt: 1 }));
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 0 });
    expect(waCalls()).toHaveLength(0);
    expect(await row(t)).toMatchObject({ status: "cancelled", blocked: true, priorRefusals: 2 });
  });

  it("takes the right number's tap once, through the shared Meta webhook", async () => {
    const t = await setup({ phoneHash: await phoneHash(PHONE, KEY) });
    await post(t, tap(`shp:${SHOP_KEY}:${ORDER}:c`, "4500000000"));
    expect((await row(t)).status).toBe("pending");
    await post(t, tap(`shp:${SHOP_KEY}:${ORDER}:c`));
    expect((await row(t)).status).toBe("confirmed");
    expect((await scheduled(t)).map((x) => [x.name, x.args[0].decision])).toContainEqual(["shopifyCodOrders:decide", "confirmed"]);
    await post(t, tap(`shp:${SHOP_KEY}:${ORDER}:x`));
    expect((await row(t)).status).toBe("confirmed");
    expect(waCalls().map((c) => c.body.text?.body)).toEqual([REPLIES.confirmed, REPLIES.already]);
  });

  it("answers 'already' when the order was cancelled in Shopify first", async () => {
    const t = await setup({ phoneHash: await phoneHash(PHONE, KEY), status: "cancelled" });
    await post(t, tap(`shp:${SHOP_KEY}:${ORDER}:c`));
    expect(waCalls().map((c) => c.body.text?.body)).toEqual([REPLIES.already]);
    expect((await scheduled(t)).map((x) => x.name)).not.toContain("shopifyCodOrders:decide");
  });

  it("adds a typed address to the order and asks again with Shopify buttons", async () => {
    const t = await setup({ phoneHash: await phoneHash(PHONE, KEY) });
    await post(t, tap(`shp:${SHOP_KEY}:${ORDER}:a`));
    expect(waCalls()[0].body.type).toBe("interactive");
    await post(t, text("Riyadh, Olaya St 12"));
    const s = await scheduled(t);
    const note = s.find((x) => x.name === "shopifyCodOrders:appendNote");
    expect(note?.args[0]).toEqual({ shopKey: SHOP_KEY, orderId: ORDER, line: addressNote({ text: "Riyadh, Olaya St 12" }) });
    expect(JSON.stringify(waCalls()[1].body)).toContain(`shp:${SHOP_KEY}:${ORDER}:c`);
    expect((await row(t)).addressAt).toBeTypeOf("number");
  });

  it("marks a failed delivery on the Shopify order", async () => {
    const t = await setup({ waMessageId: "wamid.out1" });
    await post(t, { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.out1", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] });
    expect((await row(t)).lastError).toBe("WhatsApp 131026: Message undeliverable");
  });
});

describe("hold state on reminders", () => {
  it("keeps the hold error visible after the message goes out", async () => {
    const t = await setup({ holdError: "no_fulfillment_order: Shopify had no open fulfillment order to hold" });
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 0 });
    expect(waCalls()).toHaveLength(1);
    expect((await row(t)).holdError).toMatch(/^no_fulfillment_order/);
  });

  it("stops reminding when the merchant released the hold in Shopify", async () => {
    holdNodes = [{ id: "gid://shopify/FulfillmentOrder/1", status: "OPEN", fulfillmentHolds: [] }];
    const t = await setup({ heldAt: 1 });
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 1 });
    expect(waCalls()).toHaveLength(0);
    expect(await row(t)).toMatchObject({ status: "confirmed", releasedOutside: true });
    expect(await scheduled(t)).toHaveLength(0);
  });

  it("keeps reminding while our hold is on", async () => {
    holdNodes = [{ id: "gid://shopify/FulfillmentOrder/1", status: "ON_HOLD", fulfillmentHolds: [{ id: "h", heldByRequestingApp: true }] }];
    const t = await setup({ heldAt: 1 });
    await t.action(internal.shopifyCodWhatsapp.sendConfirm, { shopKey: SHOP_KEY, orderId: ORDER, reminder: 1 });
    expect(waCalls()).toHaveLength(1);
  });
});
