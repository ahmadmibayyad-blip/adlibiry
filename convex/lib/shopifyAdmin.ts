// A small Admin GraphQL client for actions (storeCheck.ts, launchCleanup.ts):
// one request, a clear error for a revoked token, and NoAccess when the
// token lacks a scope, so callers can skip that part instead of failing.

import { ConvexError } from "convex/values";
import { SHOPIFY_API_VERSION } from "./shopifyExport";

export class NoAccess extends Error {}

export async function adminGql<T>(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new ConvexError({ code: "RECONNECT", message: "Shopify refused access. Reconnect your store in Settings → Shopify." });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] | string };
  const msg = typeof body.errors === "string" ? body.errors : (body.errors ?? []).map((e) => e.message).join("; ");
  if (res.status === 403 || /access denied|required access/i.test(msg)) throw new NoAccess(msg);
  if (!res.ok || msg || !body.data) throw new Error(`Shopify: ${msg || `HTTP ${res.status}`}`.slice(0, 300));
  return body.data;
}
