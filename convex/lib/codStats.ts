// Numbers for the merchant's dashboard, shared by Istilam on Salla (sallaEmbedded.ts) and Shopify.

/** Default cost of a refused COD parcel (two-way shipping) when the merchant hasn't set one. */
export const DEFAULT_PARCEL_COST = 35;

export type StatOrder = {
  status: string;              // "pending" | "confirmed" | "cancelled"
  answeredAt?: number;         // the customer tapped a button
  lastError?: string;
  total?: number;
  refusedAt?: number;          // confirmed, then refused at the door
  blocked?: boolean;           // cancelled without asking: the number refused before
  addressAt?: number;          // sent a new address on WhatsApp
};

export type CodStats = {
  asked: number;
  pending: number;
  confirmed: number;
  cancelledByCustomer: number;
  cancelledNoAnswer: number;
  failed: number;              // still pending with an error: the customer may not have been asked
  refused: number;             // confirmed on WhatsApp, then refused at the door
  blocked: number;             // cancelled without asking because the number refused before
  addressChanged: number;      // customers who sent a new address on WhatsApp
  answerRate: number | null;   // share of decided orders the customer answered (0..1)
  confirmRate: number | null;  // confirmed / decided (0..1)
  saved: number;               // cancelled before shipping (asked or blocked) × parcel cost
  confirmedValue: number;      // order totals confirmed
};

export function codStats(orders: StatOrder[], parcelCost = DEFAULT_PARCEL_COST): CodStats {
  let pending = 0, confirmed = 0, byCustomer = 0, noAnswer = 0, failed = 0, answered = 0, confirmedValue = 0, refused = 0, blocked = 0, addressChanged = 0;
  for (const o of orders) {
    if (o.refusedAt) refused++;
    if (o.addressAt) addressChanged++;
    if (o.status === "cancelled" && o.blocked) {
      blocked++;
    } else if (o.status === "confirmed") {
      confirmed++;
      confirmedValue += o.total ?? 0;
    } else if (o.status === "cancelled") {
      if (o.answeredAt) byCustomer++;
      else noAnswer++;
    } else {
      pending++;
      if (o.lastError) failed++;
    }
    if (o.answeredAt && o.status !== "pending") answered++;
  }
  const decided = confirmed + byCustomer + noAnswer; // blocked orders were never asked
  return {
    asked: orders.length,
    pending,
    confirmed,
    cancelledByCustomer: byCustomer,
    cancelledNoAnswer: noAnswer,
    failed,
    refused,
    blocked,
    addressChanged,
    answerRate: decided ? answered / decided : null,
    confirmRate: decided ? confirmed / decided : null,
    saved: (byCustomer + noAnswer + blocked) * parcelCost,
    confirmedValue: Math.round(confirmedValue * 100) / 100,
  };
}

/** A merchant-entered parcel cost, or null when it isn't a sensible SAR amount. */
export function parseParcelCost(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.round(n * 100) / 100;
}

export type ErrorKind =
  | "setup" | "no_mobile" | "whatsapp" | "no_status" | "address_note" | "no_fulfillment_order" | "shopify" | "salla" | "other";

/** What kind of failure a stored error is, so the dashboard can say it in the merchant's language. */
export function errorKind(error: string): ErrorKind {
  if (/WhatsApp isn't set up/i.test(error)) return "setup";
  if (/no usable mobile/i.test(error)) return "no_mobile";
  if (/^WhatsApp\b/i.test(error)) return "whatsapp";
  if (/under review/i.test(error)) return "no_status";
  if (/\/histories\b/.test(error)) return "address_note";
  if (/^no_fulfillment_order\b/.test(error)) return "no_fulfillment_order";
  if (/^Shopify\b|SHOPIFY_ISTILAM/.test(error)) return "shopify";
  if (/Salla|token|SHOPIFY_TOKEN_KEY|SALLA_CLIENT/i.test(error)) return "salla";
  return "other";
}
