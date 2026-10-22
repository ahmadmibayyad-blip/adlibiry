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

export type SallaStatus = {
  id: number;
  name: string;
  type: string;
  slug: string;
  parent?: { id: number } | null;
  children?: SallaStatus[];
};

/** Statuses and their children (sub-statuses may come nested), in one list. */
function flatten(statuses: SallaStatus[]): SallaStatus[] {
  return statuses.flatMap((s) => [s, ...flatten(s.children ?? [])]);
}

/**
 * Reads GET /orders/statuses: the "under review" main status, and our sub-status if the store has it already.
 * A store's main statuses can be its own (type "custom") copies of Salla's, so the main one is the
 * under_review status without a parent, whatever its type; Salla's own "original" wins when both exist.
 */
export function findStatusIds(statuses: SallaStatus[]): { underReviewId?: number; awaitingId?: number } {
  const all = flatten(statuses);
  const mains = all.filter((s) => s.slug === "under_review" && !s.parent);
  const underReview = mains.find((s) => s.type === "original") ?? mains[0];
  const awaiting = all.find((s) => s.name === AWAITING_STATUS.name && s.id !== underReview?.id);
  return { underReviewId: underReview?.id, awaitingId: awaiting?.id };
}

/** A short "slug/type/parent" list of what the store returned, for the error when no main status fits. */
export function describeStatuses(statuses: SallaStatus[]): string {
  return flatten(statuses)
    .map((s) => `${s.slug}/${s.type}${s.parent ? `<${s.parent.id}` : ""}`)
    .join(", ")
    .slice(0, 200);
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
