// Fetching a store's pages the way a browser would ask for them: for Store Inspector (storeInspector.ts)
// and Launch's "Copy a page's layout" (launchRun.ts, lib/pageMirror.ts).

import { firstProductPath, inspectHtml } from "./storeInspect";
import { productJsPath, teardownProductPage, vitalsOffersUrl, type Teardown } from "./storeTeardown";

// An honest bot name: Shopify answers a desktop-Chrome name that doesn't act like Chrome with 429 on
// product pages and /products/<handle>.js (seen October 2026), but serves named bots normally.
export const STORE_UA = "Mozilla/5.0 (compatible; AdSpyPro/1.0; +https://adspypro.net)";
const UA = STORE_UA;

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

/**
 * A store's product page teardown and its home page HTML, from a link to either (Mirror a page copies both).
 * A home page link mirrors its first product; home is null when the home page can't be read.
 */
export async function fetchStore(u: URL): Promise<{ teardown: Teardown | null; home: string | null }> {
  const origin = `${u.protocol}//${u.host}`;
  const isProduct = u.pathname.includes("/products/");
  const homeHtml = await fetchPage(isProduct ? `${origin}/` : u.toString());
  const home = homeHtml && inspectHtml(homeHtml).shopify ? homeHtml : null;
  const path = isProduct ? u.pathname : home ? firstProductPath(home) ?? undefined : undefined;
  const html = path ? await fetchPage(`${origin}${path}`) : null;
  if (!path || !html || !inspectHtml(html).shopify) return { teardown: null, home };
  return { teardown: await teardownAt(origin, path, html), home };
}
