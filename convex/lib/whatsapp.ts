// WhatsApp Cloud API pieces for the COD confirm app (convex/sallaWhatsapp.ts).
// The confirm message is an approved utility template with quick-reply buttons
// (confirm, cancel and, in templates listed in ADDRESS_BUTTON_TEMPLATES, edit address);
// each button's payload names the store, the order and the answer, so a tap
// comes back on the webhook as `cod:<merchantId>:<orderId>:<c|x|a>` (Salla) or
// `shp:<shopKey>:<orderId>:<c|x|a>` (Shopify, convex/shopifyCodWhatsapp.ts).
import { safeEqual } from "./shopifyOAuth";
import { signBody } from "./sallaWebhook";

export const GRAPH_API = "https://graph.facebook.com/v23.0";

/** Default template; its body must take, in order: customer name, store name, order number, total. */
export const CONFIRM_TEMPLATE = { name: "cod_order_confirm", language: "ar" } as const;

/** Templates whose third quick reply (index 2) is "تعديل العنوان"; the others have confirm + cancel only. */
export const ADDRESS_BUTTON_TEMPLATES: readonly string[] = ["cod_order_confirm_v3"];

/** How long after the address button a typed text or pin counts as the new address. */
export const ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** After the first message: reminders, then the order is cancelled for lack of an answer. */
export const REMINDER_DELAYS_MS = [2 * 60 * 60 * 1000, 22 * 60 * 60 * 1000];
export const AUTO_CANCEL_AFTER_MS = 24 * 60 * 60 * 1000; // after the last reminder

export const REPLIES = {
  confirmed: "شكراً لك! تم تأكيد طلبك وسيتم تجهيزه للشحن ✅",
  cancelled: "تم إلغاء طلبك. نتمنى خدمتك في وقت لاحق.",
  already: "تم تسجيل ردك على هذا الطلب مسبقاً. للتعديل تواصل مع المتجر.",
  askAddress: "أرسل موقعك 📍 بالضغط على الزر أدناه، أو اكتب عنوانك الجديد كاملاً (المدينة، الحي، الشارع، رقم المبنى).",
  addressSaved: "شكراً! وصلنا عنوانك الجديد وأضفناه إلى طلبك. هل تؤكد الطلب الآن؟",
} as const;

/**
 * The customer's number as WhatsApp ids write it: country code then number, digits only.
 * Salla gives `mobile` (sometimes with a leading 0) and `mobile_code` ("+966"); null when unusable.
 */
export function waNumber(mobile: unknown, mobileCode: unknown): string | null {
  const digits = (x: unknown) => (typeof x === "number" || typeof x === "string" ? String(x).replace(/\D/g, "") : "");
  let num = digits(mobile).replace(/^00/, "");
  const code = digits(mobileCode);
  if (!num) return null;
  if (code && !num.startsWith(code)) num = code + num.replace(/^0+/, "");
  return num.length >= 9 && num.length <= 15 ? num : null;
}

/** Keyed hash of the number, so a reply can be matched to its order without storing the number. */
export const phoneHash = async (wa: string, key: string) => (await signBody(wa, `wa-phone:${key}`)).slice(0, 32);

export type Answer = "confirmed" | "cancelled";
/** A button: an answer, or "address" (the customer will send a new address first). */
export type Tap = Answer | "address";

const TAP_CODE: Record<Tap, string> = { confirmed: "c", cancelled: "x", address: "a" };
const CODE_TAP: Record<string, Tap> = { c: "confirmed", x: "cancelled", a: "address" };

export const buttonPayload = (merchantId: number, orderId: string, tap: Tap) => `cod:${merchantId}:${orderId}:${TAP_CODE[tap]}`;

export function parsePayload(payload: string): { merchantId: number; orderId: string; answer: Tap } | null {
  const m = /^cod:(\d+):([\w-]+):([cxa])$/.exec(payload.trim());
  if (!m) return null;
  return { merchantId: Number(m[1]), orderId: m[2], answer: CODE_TAP[m[3]] };
}

export const shopifyButtonPayload = (shopKey: string, orderId: string, tap: Tap) => `shp:${shopKey}:${orderId}:${TAP_CODE[tap]}`;

export type AnyPayload =
  | { platform: "salla"; merchantId: number; orderId: string; answer: Tap }
  | { platform: "shopify"; shopKey: string; orderId: string; answer: Tap };

/** A tap's payload from either platform; null for anything else. */
export function parseAnyPayload(payload: string): AnyPayload | null {
  const salla = parsePayload(payload);
  if (salla) return { platform: "salla", ...salla };
  const m = /^shp:([a-z0-9]{6,16}):(\d+):([cxa])$/.exec(payload.trim());
  return m ? { platform: "shopify", shopKey: m[1], orderId: m[2], answer: CODE_TAP[m[3]] } : null;
}

/** Builds a button's payload for one order. */
export type PayloadFor = (tap: Tap) => string;

export type ConfirmParams = { customer: string; store: string; reference: string; total: string };

/** POST /{phone-number-id}/messages body for the confirm template (buttons 0 = confirm, 1 = cancel, 2 = edit address). */
export function confirmMessage(
  to: string, p: ConfirmParams, merchantId: number, orderId: string,
  template: { name: string; language: string } = CONFIRM_TEMPLATE,
): Record<string, unknown> {
  return confirmMessageWith(to, p, (t) => buttonPayload(merchantId, orderId, t), template);
}

export function confirmMessageWith(
  to: string, p: ConfirmParams, payloadFor: PayloadFor,
  template: { name: string; language: string } = CONFIRM_TEMPLATE,
): Record<string, unknown> {
  const text = (s: string) => ({ type: "text", text: s.slice(0, 60) || "-" });
  const button = (index: number, answer: Tap) => ({
    type: "button", sub_type: "quick_reply", index: String(index),
    parameters: [{ type: "payload", payload: payloadFor(answer) }],
  });
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: [
        { type: "body", parameters: [text(p.customer), text(p.store), text(p.reference), text(p.total)] },
        button(0, "confirmed"),
        button(1, "cancelled"),
        ...(ADDRESS_BUTTON_TEMPLATES.includes(template.name) ? [button(2, "address")] : []),
      ],
    },
  };
}

export const textMessage = (to: string, body: string) => ({ messaging_product: "whatsapp", to, type: "text", text: { body } });

/** WhatsApp's "Send location" request (service window only); the customer can also just type the address. */
export const locationRequest = (to: string, body: string) => ({
  messaging_product: "whatsapp", to, type: "interactive",
  interactive: { type: "location_request_message", body: { text: body }, action: { name: "send_location" } },
});

/** Confirm / cancel as plain reply buttons (service window only); taps come back as `interactive` with the same payloads. */
export const answerButtons = (to: string, body: string, merchantId: number, orderId: string) =>
  answerButtonsWith(to, body, (t) => buttonPayload(merchantId, orderId, t));

export const answerButtonsWith = (to: string, body: string, payloadFor: PayloadFor) => ({
  messaging_product: "whatsapp", to, type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: {
      buttons: [
        { type: "reply", reply: { id: payloadFor("confirmed"), title: "تأكيد الطلب" } },
        { type: "reply", reply: { id: payloadFor("cancelled"), title: "إلغاء الطلب" } },
      ],
    },
  },
});

/** The order-history note for a new address: the typed text, or a map link for a pin. */
export function addressNote(a: { text: string } | { lat: number; lng: number; name?: string; address?: string }): string {
  if ("text" in a) return `عنوان جديد من العميل عبر واتساب: ${a.text.trim().slice(0, 500)}`;
  const label = [a.name, a.address].filter((x) => x?.trim()).join("، ").slice(0, 200);
  return `موقع العميل عبر واتساب: https://maps.google.com/?q=${a.lat},${a.lng}${label ? ` (${label})` : ""}`;
}

/** Meta signs each delivery: X-Hub-Signature-256 = "sha256=" + hex HMAC of the raw body with the app secret. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  const given = header?.trim().toLowerCase().replace(/^sha256=/, "");
  if (!given) return false;
  return safeEqual(await signBody(rawBody, appSecret), given);
}

type WaMessage = {
  from?: unknown; id?: unknown; type?: string;
  button?: { payload?: unknown };
  interactive?: { button_reply?: { id?: unknown } };
  text?: { body?: unknown };
  location?: { latitude?: unknown; longitude?: unknown; name?: unknown; address?: unknown };
};
type WaStatus = { id?: unknown; status?: string; errors?: { code?: number; title?: string; message?: string }[] };

export type WaEvent =
  | { kind: "button"; from: string; payload: string; messageId: string }
  | { kind: "text"; from: string; text: string; messageId: string }
  | { kind: "location"; from: string; lat: number; lng: number; name?: string; address?: string; messageId: string }
  | { kind: "failed"; messageId: string; error: string };

/** Button taps, typed text, shared locations and failed deliveries from a webhook body; the rest (read receipts, media) is skipped. */
export function parseWaWebhook(body: unknown): WaEvent[] {
  const out: WaEvent[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of ((entry as { changes?: unknown[] })?.changes ?? []) as { value?: Record<string, unknown> }[]) {
      const value = change?.value ?? {};
      for (const m of (Array.isArray(value.messages) ? value.messages : []) as WaMessage[]) {
        // Template quick replies come as type "button"; interactive buttons as "interactive" (kept for later flows).
        const payload = m.type === "button" ? m.button?.payload : m.type === "interactive" ? m.interactive?.button_reply?.id : undefined;
        if (typeof m.from !== "string") continue;
        const messageId = String(m.id ?? "");
        if (typeof payload === "string") {
          out.push({ kind: "button", from: m.from, payload, messageId });
        } else if (m.type === "text" && typeof m.text?.body === "string" && m.text.body.trim()) {
          out.push({ kind: "text", from: m.from, text: m.text.body, messageId });
        } else if (m.type === "location") {
          const lat = Number(m.location?.latitude), lng = Number(m.location?.longitude);
          const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            out.push({ kind: "location", from: m.from, lat, lng, name: str(m.location?.name), address: str(m.location?.address), messageId });
          }
        }
      }
      for (const s of (Array.isArray(value.statuses) ? value.statuses : []) as WaStatus[]) {
        if (s.status !== "failed" || typeof s.id !== "string") continue;
        const e = Array.isArray(s.errors) ? s.errors[0] : undefined;
        out.push({ kind: "failed", messageId: s.id, error: `WhatsApp ${e?.code ?? "?"}: ${e?.title ?? e?.message ?? "delivery failed"}`.slice(0, 300) });
      }
    }
  }
  return out;
}
