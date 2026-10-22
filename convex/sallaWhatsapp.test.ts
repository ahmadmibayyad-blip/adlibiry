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
    if (url.endsWith(`/orders/${ORDER}`)) {
      return json({ data: { reference_id: 295064334, customer: { first_name: "أحمد", mobile: 555123456, mobile_code: "+966" }, amounts: { total: { amount: 199, currency: "SAR" } } } });
    }
    if (url.endsWith("/store/info")) return json({ data: { name: "متجر الاختبار" } });
    if (url.endsWith("/status")) return json({ data: { message: "ok" } }, 201);
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

  it("answers Meta's verify request", async () => {
    const t = await setup();
    const ok = await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123");
    expect(await ok.text()).toBe("123");
    expect((await t.fetch("/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status).toBe(403);
  });
});
