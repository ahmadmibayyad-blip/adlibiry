import { describe, expect, it } from "vitest";
import { addressNote, buttonPayload, confirmMessage, parsePayload, parseWaWebhook, phoneHash, verifyMetaSignature, waNumber } from "./whatsapp";
import { signBody } from "./sallaWebhook";

describe("waNumber", () => {
  it("joins Salla's mobile and code into WhatsApp's digits-only form", () => {
    expect(waNumber(555123456, "+966")).toBe("966555123456");
    expect(waNumber("0555123456", "+966")).toBe("966555123456");
    expect(waNumber("+971 50 123 4567", "+971")).toBe("971501234567");
    expect(waNumber("00966555123456", "+966")).toBe("966555123456");
  });
  it("refuses what can't be a number", () => {
    expect(waNumber(undefined, "+966")).toBeNull();
    expect(waNumber("12", "")).toBeNull();
  });
});

describe("button payloads", () => {
  it("round-trip", () => {
    expect(parsePayload(buttonPayload(212746149, "445306537", "confirmed"))).toEqual({ merchantId: 212746149, orderId: "445306537", answer: "confirmed" });
    expect(parsePayload(buttonPayload(1, "9", "cancelled"))?.answer).toBe("cancelled");
  });
  it("ignore anything else", () => {
    expect(parsePayload("نعم")).toBeNull();
    expect(parsePayload("cod:1:9:y")).toBeNull();
  });
});

it("builds the template with body params and one payload per button", () => {
  const m = confirmMessage("966555123456", { customer: "أحمد", store: "متجري", reference: "295064334", total: "199 SAR" }, 7, "42") as { to: string; template: { components: { index?: string; parameters: { text?: string; payload?: string }[] }[] } };
  expect(m).toMatchObject({ to: "966555123456", type: "template", template: { name: "cod_order_confirm", language: { code: "ar" } } });
  expect(m.template.components[0].parameters.map((p) => p.text)).toEqual(["أحمد", "متجري", "295064334", "199 SAR"]);
  expect(m.template.components[1].parameters[0].payload).toBe("cod:7:42:c");
  expect(m.template.components[2]).toMatchObject({ index: "1", parameters: [{ payload: "cod:7:42:x" }] });
});

it("checks Meta's signature", async () => {
  const sig = `sha256=${await signBody("{}", "app-secret")}`;
  expect(await verifyMetaSignature("{}", sig, "app-secret")).toBe(true);
  expect(await verifyMetaSignature("{ }", sig, "app-secret")).toBe(false);
  expect(await verifyMetaSignature("{}", null, "app-secret")).toBe(false);
});

it("hashes numbers per key", async () => {
  expect(await phoneHash("966555123456", "k1")).toBe(await phoneHash("966555123456", "k1"));
  expect(await phoneHash("966555123456", "k1")).not.toBe(await phoneHash("966555123456", "k2"));
});

it("reads button taps, texts and failed deliveries, skips the rest", () => {
  const body = {
    entry: [{
      changes: [{
        value: {
          messages: [
            { from: "966555123456", id: "wamid.1", type: "button", button: { payload: "cod:7:42:c", text: "تأكيد الطلب" } },
            { from: "966555123456", id: "wamid.2", type: "text", text: { body: "hello" } },
            { from: "966555123456", id: "wamid.3", type: "image", image: { id: "m1" } },
          ],
          statuses: [
            { id: "wamid.0", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
            { id: "wamid.0", status: "read" },
          ],
        },
      }],
    }],
  };
  expect(parseWaWebhook(body)).toEqual([
    { kind: "button", from: "966555123456", payload: "cod:7:42:c", messageId: "wamid.1" },
    { kind: "text", from: "966555123456", text: "hello", messageId: "wamid.2" },
    { kind: "failed", messageId: "wamid.0", error: "WhatsApp 131026: Message undeliverable" },
  ]);
  expect(parseWaWebhook(null)).toEqual([]);
});

describe("edit address pieces", () => {
  it("reads the address tap", () => {
    expect(parsePayload("cod:1:22:a")).toEqual({ merchantId: 1, orderId: "22", answer: "address" });
  });
  it("reads typed text and shared locations", () => {
    const body = { entry: [{ changes: [{ value: { messages: [
      { from: "966", id: "w1", type: "text", text: { body: "حي النرجس" } },
      { from: "966", id: "w2", type: "location", location: { latitude: "24.7", longitude: 46.6, address: "الرياض" } },
      { from: "966", id: "w3", type: "location", location: {} },
      { from: "966", id: "w4", type: "text", text: { body: "  " } },
    ] } }] }] };
    expect(parseWaWebhook(body)).toEqual([
      { kind: "text", from: "966", text: "حي النرجس", messageId: "w1" },
      { kind: "location", from: "966", lat: 24.7, lng: 46.6, name: undefined, address: "الرياض", messageId: "w2" },
    ]);
  });
  it("writes the history note", () => {
    expect(addressNote({ text: "  حي النرجس " })).toBe("عنوان جديد من العميل عبر واتساب: حي النرجس");
    expect(addressNote({ lat: 1.5, lng: 2 })).toBe("موقع العميل عبر واتساب: https://maps.google.com/?q=1.5,2");
  });
});
