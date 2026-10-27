// Salla-only dashboard helpers; the shared numbers live in codStats.ts.
export * from "./codStats";

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
