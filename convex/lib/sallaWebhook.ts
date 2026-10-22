// Salla app webhooks (the COD confirm app, see convex/sallaApp.ts).
// Salla signs each delivery with x-salla-signature = hex HMAC-SHA256 of the raw
// body, keyed by the app's webhook secret (security strategy "signature").
import { safeEqual } from "./shopifyOAuth";

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export async function signBody(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody))));
}

/** True when any of the secrets (current, and the previous one during a rotation) signed this body. */
export async function verifySallaSignature(rawBody: string, header: string | null, secrets: string[]): Promise<boolean> {
  const given = header?.trim().toLowerCase();
  if (!given) return false;
  for (const s of secrets) if (safeEqual(await signBody(rawBody, s), given)) return true;
  return false;
}

export type SallaEvent = { event: string; merchant: number; created_at?: string; data: Record<string, unknown> };

/** The envelope every Salla webhook shares; null when the body isn't one. The store id is top-level `merchant`. */
export function parseSallaEvent(raw: string): SallaEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const merchant = Number(b.merchant);
  if (typeof b.event !== "string" || !Number.isFinite(merchant) || merchant <= 0) return null;
  const data = b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : {};
  return { event: b.event, merchant, created_at: typeof b.created_at === "string" ? b.created_at : undefined, data };
}

export type SallaTokens = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };

/** app.store.authorize data (install or token refresh); null when malformed so nothing broken gets saved. */
export function parseAuthorize(data: Record<string, unknown>): SallaTokens | null {
  const { access_token, refresh_token, expires, scope } = data;
  if (typeof access_token !== "string" || !access_token) return null;
  if (typeof refresh_token !== "string" || !refresh_token) return null;
  if (typeof expires !== "number" || !Number.isFinite(expires)) return null;
  return { accessToken: access_token, refreshToken: refresh_token, expiresAt: expires * 1000, scope: typeof scope === "string" ? scope : "" };
}

export type CodOrder = { orderId: string; referenceId?: string; total?: number; currency?: string };

/**
 * The order from an order.created payload when it's cash on delivery, else null.
 * Salla marks COD with payment_method "cod". Only ids and the amount are kept:
 * no customer name, phone or address (PDPL: store the minimum).
 */
export function codOrderFrom(data: Record<string, unknown>): CodOrder | null {
  if (String(data.payment_method ?? "").toLowerCase() !== "cod") return null;
  const id = data.id;
  if ((typeof id !== "number" && typeof id !== "string") || id === "") return null;
  const ref = data.reference_id;
  const amounts = data.amounts as { total?: { amount?: unknown; currency?: unknown } } | undefined;
  const amount = Number(amounts?.total?.amount);
  const currency = amounts?.total?.currency;
  return {
    orderId: String(id),
    referenceId: typeof ref === "number" || typeof ref === "string" ? String(ref) : undefined,
    total: Number.isFinite(amount) ? amount : undefined,
    currency: typeof currency === "string" ? currency : undefined,
  };
}
