// WhatsApp Cloud API pieces for the COD confirm app (convex/sallaWhatsapp.ts).
// The confirm message is an approved utility template with two quick-reply buttons;
// each button's payload names the store, the order and the answer, so a tap
// comes back on the webhook as `cod:<merchantId>:<orderId>:<c|x>`.
import { safeEqual } from "./shopifyOAuth";
import { signBody } from "./sallaWebhook";

export const GRAPH_API = "https://graph.facebook.com/v23.0";

/** Default template; its body must take, in order: customer name, store name, order number, total. */
export const CONFIRM_TEMPLATE = { name: "cod_order_confirm", language: "ar" } as const;

/** After the first message: reminders, then the order is cancelled for lack of an answer. */
export const REMINDER_DELAYS_MS = [2 * 60 * 60 * 1000, 22 * 60 * 60 * 1000];
export const AUTO_CANCEL_AFTER_MS = 24 * 60 * 60 * 1000; // after the last reminder

export const REPLIES = {
  confirmed: "شكراً لك! تم تأكيد طلبك وسيتم تجهيزه للشحن ✅",
  cancelled: "تم إلغاء طلبك. نتمنى خدمتك في وقت لاحق.",
  already: "تم تسجيل ردك على هذا الطلب مسبقاً. للتعديل تواصل مع المتجر.",
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

export const buttonPayload = (merchantId: number, orderId: string, answer: Answer) =>
  `cod:${merchantId}:${orderId}:${answer === "confirmed" ? "c" : "x"}`;

export function parsePayload(payload: string): { merchantId: number; orderId: string; answer: Answer } | null {
  const m = /^cod:(\d+):([\w-]+):([cx])$/.exec(payload.trim());
  if (!m) return null;
  return { merchantId: Number(m[1]), orderId: m[2], answer: m[3] === "c" ? "confirmed" : "cancelled" };
}

export type ConfirmParams = { customer: string; store: string; reference: string; total: string };

/** POST /{phone-number-id}/messages body for the confirm template (buttons 0 = confirm, 1 = cancel). */
export function confirmMessage(
  to: string, p: ConfirmParams, merchantId: number, orderId: string,
  template: { name: string; language: string } = CONFIRM_TEMPLATE,
): Record<string, unknown> {
  const text = (s: string) => ({ type: "text", text: s.slice(0, 60) || "-" });
  const button = (index: number, answer: Answer) => ({
    type: "button", sub_type: "quick_reply", index: String(index),
    parameters: [{ type: "payload", payload: buttonPayload(merchantId, orderId, answer) }],
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
      ],
    },
  };
}

export const textMessage = (to: string, body: string) => ({ messaging_product: "whatsapp", to, type: "text", text: { body } });

/** Meta signs each delivery: X-Hub-Signature-256 = "sha256=" + hex HMAC of the raw body with the app secret. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  const given = header?.trim().toLowerCase().replace(/^sha256=/, "");
  if (!given) return false;
  return safeEqual(await signBody(rawBody, appSecret), given);
}

type WaMessage = { from?: unknown; id?: unknown; type?: string; button?: { payload?: unknown }; interactive?: { button_reply?: { id?: unknown } } };
type WaStatus = { id?: unknown; status?: string; errors?: { code?: number; title?: string; message?: string }[] };

export type WaEvent =
  | { kind: "button"; from: string; payload: string; messageId: string }
  | { kind: "failed"; messageId: string; error: string };

/** Button taps and failed deliveries from a webhook body; everything else (typed text, read receipts) is skipped. */
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
        if (typeof payload === "string" && typeof m.from === "string") {
          out.push({ kind: "button", from: m.from, payload, messageId: String(m.id ?? "") });
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
