// A connected store's name, currency and main language, read with its Admin
// API token. Two requests: shopLocales needs read_locales, which many tokens
// don't have, and in one query its "access denied" would also lose the name
// and currency (that left stores named "x.myshopify.com" and priced in USD).

import { SHOPIFY_API_VERSION } from "./shopifyExport";

export type StoreInfo = { name?: string; currency?: string; locale?: string };

async function gql(shop: string, token: string, query: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> };
    return res.ok ? body.data : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchStoreInfo(shop: string, token: string): Promise<StoreInfo> {
  const s = (await gql(shop, token, "{ shop { name currencyCode } }"))?.shop as { name?: string; currencyCode?: string } | undefined;
  const locales = (await gql(shop, token, "{ shopLocales(published: true) { locale primary } }"))?.shopLocales as { locale: string; primary: boolean }[] | undefined;
  const locale = locales?.find((l) => l.primary)?.locale;
  return { ...(s?.name ? { name: s.name } : {}), ...(s?.currencyCode ? { currency: s.currencyCode } : {}), ...(locale ? { locale } : {}) };
}
