/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { encryptToken } from "./lib/shopifyOAuth";
import { signBody } from "./lib/sallaWebhook";
import { AUTO_CANCEL_AFTER_MS, REMINDER_DELAYS_MS } from "./lib/whatsapp";

const modules = import.meta.glob("./**/*.ts");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const MERCHANT = 212746149;
const ORDER = "445306537";
const PHONE = "966555123456";

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SHOPIFY_TOKEN_KEY", KEY);
  vi.stubEnv("WHATSAPP_TOKEN", "wa-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234");
  vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-me");
  vi.stubEnv("SALLA_WEBHOOK_SECRET", "salla-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are read field by field
type Call = { url: string; method: string; body: any };
function stubApis(calls: Call[]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.includes("graph.facebook.com")) return json({ messages: [{ id: `wamid.${calls.length}` }] });
    if (/\/orders\/\d+$/.test(url)) {
      return json({ data: { reference_id: 295064334, customer: { first_name: "أحمد", mobile: 555123456, mobile_code: "+966" }, amounts: { total: { amount: 199, currency: "SAR" } } } });
    }
    if (url.endsWith("/store/info")) return json({ data: { name: "متجر الاختبار" } });
    if (url.endsWith("/status")) return json({ data: { message: "ok" } }, 201);
    if (url.endsWith("/histories")) return json({ data: { id: 1 } });
    return json({}, 404);
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("sallaStores", {
      merchantId: MERCHANT,
      accessToken: await encryptToken("access-1", KEY),
      refreshToken: await encryptToken("refresh-1", KEY),
      expiresAt: Date.now() + 10 * 86400_000,
      scope: "orders.read_write",
      installedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("sallaCodOrders", { merchantId: MERCHANT, orderId: ORDER, status: "pending", createdAt: Date.now() });
  });
  return t;
}

const order = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.query("sallaCodOrders").collect())[0]);
const path = (c: Call) => `${c.method} ${c.url.replace(/^https:\/\/[^/]+(\/admin\/v2|\/v\d+\.\d)?/, "")}`;

async function post(t: ReturnType<typeof convexTest>, body: object, secret = "app-secret") {
  const raw = JSON.stringify(body);
  return t.fetch("/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${await signBody(raw, secret)}` } });
}
const tap = (payload: string, from = PHONE, id = "wamid.in1") => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "button", button: { payload, text: "x" } }] } }] }],
});

describe("WhatsApp COD confirmation", () => {
  it("sends the template, takes the customer's tap once and writes it to Salla", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    expect(calls.map(path)).toEqual([`GET /orders/${ORDER}`, "GET /store/info", "POST /1234/messages"]);
    const msg = calls[2].body;
    expect(msg.to).toBe(PHONE);
    expect(msg.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["أحمد", "متجر الاختبار", "295064334", "199 SAR"]);
    const sent = await order(t);
    expect(sent).toMatchObject({ waMessageId: "wamid.3", reminders: 0 });
    expect(JSON.stringify(sent)).not.toContain("555123456"); // number never stored

    calls.length = 0;
    expect((await post(t, tap(`cod:${MERCHANT}:${ORDER}:c`))).status).toBe(200);
    expect(await order(t)).toMatchObject({ status: "confirmed" });
    expect(calls.map(path)).toEqual(["POST /1234/messages"]); // the thank-you text
    expect(calls[0].body).toMatchObject({ to: PHONE, type: "text" });

    await t.finishAllScheduledFunctions(vi.runAllTimers); // the write-back, and reminders that now do nothing
    expect(calls.some((c) => path(c) === `POST /orders/${ORDER}/status` && c.body.slug === "in_progress")).toBe(true);

    // Meta's retry of the same tap does nothing; a later Cancel tap is told it was already answered.
    calls.length = 0;
    await post(t, tap(`cod:${MERCHANT}:${ORDER}:c`));
    expect(calls).toEqual([]);
    await post(t, tap(`cod:${MERCHANT}:${ORDER}:x`, PHONE, "wamid.in2"));
    expect(await order(t)).toMatchObject({ status: "confirmed" });
    expect(calls[0].body.text.body).toContain("مسبقاً");
  });

  it("ignores a tap from another number and unsigned deliveries", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    await post(t, tap(`cod:${MERCHANT}:${ORDER}:x`, "966500000000"));
    expect((await post(t, tap(`cod:${MERCHANT}:${ORDER}:x`, PHONE, "wamid.in9"), "wrong")).status).toBe(401);
    expect((await order(t)).status).toBe("pending");
  });

  it("reminds twice, then cancels the order with stock restored", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    for (const ms of [...REMINDER_DELAYS_MS, AUTO_CANCEL_AFTER_MS]) {
      vi.advanceTimersByTime(ms);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(calls.filter((c) => path(c) === "POST /1234/messages")).toHaveLength(3);
    expect(await order(t)).toMatchObject({ status: "cancelled", reminders: 2 });
    expect(calls.find((c) => c.url.endsWith("/status"))?.body).toMatchObject({ slug: "canceled", restore_items: true });
  });

  it("notes on the order when WhatsApp isn't set up or delivery fails", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    vi.stubEnv("WHATSAPP_TOKEN", "");
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    expect((await order(t)).lastError).toContain("isn't set up");

    vi.stubEnv("WHATSAPP_TOKEN", "wa-token");
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    const id = (await order(t)).waMessageId!;
    await post(t, { entry: [{ changes: [{ value: { statuses: [{ id, status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] });
    expect((await order(t)).lastError).toBe("WhatsApp 131026: Message undeliverable");
  });

  it("remembers a number that confirmed and then refused, and flags or cancels its next COD order", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    await post(t, tap(`cod:${MERCHANT}:${ORDER}:c`));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The parcel came back: Salla reports the order as restored.
    const evt = JSON.stringify({ event: "order.status.updated", merchant: MERCHANT, data: { id: 1, order: { id: Number(ORDER), status: { slug: "restored" } } } });
    const salla = () => t.fetch("/salla/webhook", { method: "POST", headers: { "x-salla-signature": "" }, body: evt });
    expect((await salla()).status).toBe(401);
    expect((await t.fetch("/salla/webhook", { method: "POST", headers: { "x-salla-signature": await signBody(evt, "salla-secret") }, body: evt })).status).toBe(200);
    expect(await order(t)).toMatchObject({ status: "confirmed", refusedAt: expect.any(Number) });
    const refusers = await t.run((ctx) => ctx.db.query("sallaRefusers").collect());
    expect(refusers).toMatchObject([{ merchantId: MERCHANT, refusals: 1 }]);
    expect(JSON.stringify(refusers)).not.toContain("555123456");

    const newOrder = async (orderId: string) => {
      await t.run((ctx) => ctx.db.insert("sallaCodOrders", { merchantId: MERCHANT, orderId, status: "pending", createdAt: Date.now() }));
      calls.length = 0;
      await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId, reminder: 0 });
      return t.run(async (ctx) => (await ctx.db.query("sallaCodOrders").withIndex("by_merchant_order", (q) => q.eq("merchantId", MERCHANT).eq("orderId", orderId)).unique())!);
    };
    // Default: still asked, but flagged.
    const flagged = await newOrder("445306538");
    expect(flagged).toMatchObject({ status: "pending", priorRefusals: 1 });
    expect(calls.some((c) => path(c) === "POST /1234/messages")).toBe(true);

    // With "cancel past refusers" on: cancelled without a message, stock restored.
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("sallaStores").first())!;
      await ctx.db.patch("sallaStores", s._id, { blockRefusers: true });
    });
    const blocked = await newOrder("445306539");
    expect(blocked).toMatchObject({ status: "cancelled", blocked: true, priorRefusals: 1 });
    expect(blocked.answeredAt).toBeUndefined();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // (the flagged order's reminders run here too; none of the messages is about the blocked one)
    expect(calls.some((c) => path(c) === "POST /1234/messages" && JSON.stringify(c.body).includes("445306539"))).toBe(false);
    expect(calls.find((c) => c.url.endsWith("/orders/445306539/status"))?.body).toMatchObject({ slug: "canceled", restore_items: true });
  });

  it("answers Meta's verify request", async () => {
    const t = await setup();
    const ok = await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123");
    expect(await ok.text()).toBe("123");
    expect((await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status).toBe(403);
  });
});

const inbound = (message: object, id: string, from = PHONE) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, ...message }] } }] }],
});

describe("Edit address on WhatsApp", () => {
  it("asks for a pin, puts the new address in Salla's order history, then takes the confirm", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE", "cod_order_confirm_v3");
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    const buttons = calls[2].body.template.components.slice(1);
    expect(buttons.map((b: { parameters: { payload: string }[] }) => b.parameters[0].payload))
      .toEqual([`cod:${MERCHANT}:${ORDER}:c`, `cod:${MERCHANT}:${ORDER}:x`, `cod:${MERCHANT}:${ORDER}:a`]);

    // A text before the address button is left alone.
    calls.length = 0;
    await post(t, inbound({ type: "text", text: { body: "مرحبا" } }, "wamid.early"));
    expect(calls).toEqual([]);

    await post(t, tap(`cod:${MERCHANT}:${ORDER}:a`, PHONE, "wamid.addr"));
    expect(calls[calls.length - 1].body.interactive).toMatchObject({ type: "location_request_message", action: { name: "send_location" } });
    expect((await order(t)).status).toBe("pending");

    calls.length = 0;
    await post(t, inbound({ type: "location", location: { latitude: 24.7136, longitude: 46.6753, name: "البيت" } }, "wamid.loc"));
    expect(calls.map(path)).toEqual([`POST /orders/${ORDER}/histories`, "POST /1234/messages"]);
    expect(calls[0].body.note).toBe("موقع العميل عبر واتساب: https://maps.google.com/?q=24.7136,46.6753 (البيت)");
    expect(calls[1].body.interactive.action.buttons.map((b: { reply: { id: string } }) => b.reply.id))
      .toEqual([`cod:${MERCHANT}:${ORDER}:c`, `cod:${MERCHANT}:${ORDER}:x`]);
    const o = await order(t);
    expect(o.addressAt).toBeTypeOf("number");
    expect(JSON.stringify(o)).not.toContain("46.6753"); // the address itself isn't kept

    // A typed address after the pin is added too, without asking again.
    calls.length = 0;
    await post(t, inbound({ type: "text", text: { body: "حي النرجس، شارع 12، مبنى 4" } }, "wamid.txt"));
    expect(calls.map(path)).toEqual([`POST /orders/${ORDER}/histories`]);
    expect(calls[0].body.note).toBe("عنوان جديد من العميل عبر واتساب: حي النرجس، شارع 12، مبنى 4");

    // The reply button confirms like the template's.
    await post(t, inbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: `cod:${MERCHANT}:${ORDER}:c`, title: "تأكيد الطلب" } } }, "wamid.ok"));
    expect((await order(t)).status).toBe("confirmed");

    // After the answer, texts aren't taken as addresses any more.
    calls.length = 0;
    await post(t, inbound({ type: "text", text: { body: "شكرا" } }, "wamid.thanks"));
    expect(calls).toEqual([]);
  });

  it("ignores the address button from another number", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE", "cod_order_confirm_v3");
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    calls.length = 0;
    await post(t, tap(`cod:${MERCHANT}:${ORDER}:a`, "966500000000", "wamid.other"));
    expect(calls).toEqual([]);
    expect((await order(t)).addressAskedAt).toBeUndefined();
  });

  it("keeps two buttons for templates without the address button", async () => {
    const t = await setup();
    const calls: Call[] = [];
    stubApis(calls);
    await t.action(internal.sallaWhatsapp.sendConfirm, { merchantId: MERCHANT, orderId: ORDER, reminder: 0 });
    expect(calls[2].body.template.components).toHaveLength(3);
  });
});
