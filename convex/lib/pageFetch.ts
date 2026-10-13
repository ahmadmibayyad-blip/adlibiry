// Fetching a store's pages the way a browser would ask for them: for Store Inspector (storeInspector.ts)
// and Launch's "Copy a page's layout" (launchRun.ts, lib/pageMirror.ts).

import { firstProductPath, inspectHtml } from "./storeInspect";
import { productJsPath, teardownProductPage, vitalsOffersUrl, type Teardown } from "./storeTeardown";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

/** JSON such as /products/<handle>.js (the product's prices and variants). */
export async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const text = await res.text();
    return text.length < 2_000_000 ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** The teardown of a product page we already have the HTML of (its product JSON and Vitals' offers are fetched). */
export async function teardownAt(origin: string, productPath: string, productHtml: string, currency?: string): Promise<Teardown> {
  const jsPath = productJsPath(productPath);
  const json = jsPath ? await fetchJson(`${origin}${jsPath}`) : undefined;
  // Vitals' volume discounts aren't in the page; its widget reads them from this JSON.
  const id = (json as { id?: unknown } | undefined)?.id;
  const vitalsUrl = vitalsOffersUrl(productHtml, typeof id === "number" ? id : undefined);
  const vitalsOffers = vitalsUrl ? await fetchJson(vitalsUrl) : undefined;
  return teardownProductPage(productHtml, productPath, json, inspectHtml(productHtml).currency ?? currency, vitalsOffers);
}

/** A product page's teardown from its link (a store's home page gives its first product); null when it can't be read. */
export async function fetchTeardown(u: URL): Promise<Teardown | null> {
  const origin = `${u.protocol}//${u.host}`;
  // A store's home page: its first product.
  const home = u.pathname.includes("/products/") ? null : await fetchPage(u.toString());
  const path = u.pathname.includes("/products/") ? u.pathname : home ? firstProductPath(home) ?? undefined : undefined;
  const html = path ? await fetchPage(`${origin}${path}`) : null;
  if (!path || !html || !inspectHtml(html).shopify) return null;
  return teardownAt(origin, path, html);
}
