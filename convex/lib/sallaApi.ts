// Salla Merchant API pieces for the COD confirm app (convex/sallaOrders.ts).
// Orders it holds get a custom sub-status of "under_review"; the customer's answer
// moves them on to in_progress (confirmed) or canceled (stock restored).

export const SALLA_API = "https://api.salla.dev/admin/v2";
export const SALLA_TOKEN_URL = "https://accounts.salla.sa/oauth2/token";

/** The sub-status the app creates in each store, under Salla's "under review". */
export const AWAITING_STATUS = {
  name: "بانتظار التأكيد",
  message: "بانتظار تأكيد الطلب عبر واتساب",
  icon: "sicon-whatsapp",
} as const;

export type SallaStatus = { id: number; name: string; type: string; slug: string; parent?: { id: number } | null };

/** Reads GET /orders/statuses: the "under review" main status, and our sub-status if the store has it already. */
export function findStatusIds(statuses: SallaStatus[]): { underReviewId?: number; awaitingId?: number } {
  const underReview = statuses.find((s) => s.type === "original" && s.slug === "under_review");
  const awaiting = statuses.find((s) => s.type === "custom" && s.name === AWAITING_STATUS.name);
  return { underReviewId: underReview?.id, awaitingId: awaiting?.id };
}

export type Decision = "confirmed" | "cancelled";

/** POST /orders/{id}/status body for the customer's answer. A cancelled COD order puts its items back in stock. */
export function statusBody(decision: Decision, note: string): Record<string, unknown> {
  return decision === "confirmed"
    ? { slug: "in_progress", note }
    : { slug: "canceled", note, restore_items: true };
}

/** Refresh this long before the access token runs out (Salla's last 14 days). */
export const REFRESH_EARLY_MS = 24 * 60 * 60 * 1000;
/** A refresh that holds the lock longer than this is treated as dead. */
export const REFRESH_LOCK_MS = 30 * 1000;
