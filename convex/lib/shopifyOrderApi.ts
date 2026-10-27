// The Shopify Admin GraphQL API for the order features (profit.ts, orders.ts): unlike lib/shopifyAdmin.ts (one
// request, for the store check) it retries rate limits, THROTTLED answers and hiccups, since a recount pages
// through many orders, and it names the missing permission. Pure apart from fetch.

import { SHOPIFY_API_VERSION } from "./shopifyExport";

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly code: "RECONNECT" | "ACCESS" | "SHOPIFY",
  ) {
    super(message);
  }
}

export async function orderGql<T = Record<string, unknown>>(
  shop: string, token: string, query: string, variables?: Record<string, unknown>, version = SHOPIFY_API_VERSION,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ShopifyError("Shopify refused access. Reconnect your store in Settings → Shopify.", "RECONNECT");
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] | string };
    if (!res.ok || body.errors) {
      const list = typeof body.errors === "string" ? [{ message: body.errors, extensions: undefined }] : (body.errors ?? []);
      if (list.some((e) => e.extensions?.code === "THROTTLED")) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const msg = list.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      if (/access denied|required access|protected customer data|not approved to access/i.test(msg)) {
        throw new ShopifyError(`Your Shopify connection is missing a permission. Reconnect your store in Settings → Shopify and approve it. (${msg.slice(0, 160)})`, "ACCESS");
      }
      throw new ShopifyError(`Shopify: ${msg}`.slice(0, 300), "SHOPIFY");
    }
    return (body.data ?? {}) as T;
  }
  throw new ShopifyError("Shopify is busy right now. Please try again in a minute.", "SHOPIFY");
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in a time zone. */
export function localDay(at: string | number, timeZone: string): string {
  const d = new Date(at);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
