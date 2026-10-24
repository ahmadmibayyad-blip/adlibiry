// Numbers for the merchant's dashboard inside Salla (convex/sallaEmbedded.ts).

/** Default cost of a refused COD parcel (two-way shipping) when the merchant hasn't set one. */
export const DEFAULT_PARCEL_COST = 35;

export type StatOrder = {
  status: string;              // "pending" | "confirmed" | "cancelled"
  answeredAt?: number;         // the customer tapped a button
  lastError?: string;
  total?: number;
};

export type CodStats = {
  asked: number;
  pending: number;
  confirmed: number;
  cancelledByCustomer: number;
  cancelledNoAnswer: number;
  failed: number;              // still pending with an error: the customer may not have been asked
  answerRate: number | null;   // share of decided orders the customer answered (0..1)
  confirmRate: number | null;  // confirmed / decided (0..1)
  saved: number;               // cancelled before shipping × parcel cost
  confirmedValue: number;      // order totals confirmed
};

export function codStats(orders: StatOrder[], parcelCost = DEFAULT_PARCEL_COST): CodStats {
  let pending = 0, confirmed = 0, byCustomer = 0, noAnswer = 0, failed = 0, answered = 0, confirmedValue = 0;
  for (const o of orders) {
    if (o.status === "confirmed") {
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
  const decided = confirmed + byCustomer + noAnswer;
  return {
    asked: orders.length,
    pending,
    confirmed,
    cancelledByCustomer: byCustomer,
    cancelledNoAnswer: noAnswer,
    failed,
    answerRate: decided ? answered / decided : null,
    confirmRate: decided ? confirmed / decided : null,
    saved: (byCustomer + noAnswer) * parcelCost,
    confirmedValue: Math.round(confirmedValue * 100) / 100,
  };
}

/** A merchant-entered parcel cost, or null when it isn't a sensible SAR amount. */
export function parseParcelCost(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.round(n * 100) / 100;
}

/** Salla's token introspection answer: the merchant, or null when it isn't a valid, unexpired token. */
export function readIntrospect(body: unknown, now = Date.now()): { merchantId: number; userId?: number; expiresAt: number } | null {
  const b = body as { success?: boolean; data?: { merchant_id?: unknown; user_id?: unknown; exp?: unknown } } | null;
  if (!b?.success || !b.data) return null;
  const merchantId = Number(b.data.merchant_id);
  if (!Number.isInteger(merchantId) || merchantId <= 0) return null;
  // exp is an ISO-8601 string, not epoch seconds.
  const exp = typeof b.data.exp === "string" ? Date.parse(b.data.exp) : NaN;
  if (Number.isFinite(exp) && exp <= now) return null;
  const userId = Number(b.data.user_id);
  return { merchantId, userId: Number.isInteger(userId) ? userId : undefined, expiresAt: Number.isFinite(exp) ? exp : now + 60 * 60 * 1000 };
}
