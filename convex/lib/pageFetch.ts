// Fetching a store's pages the way a browser would ask for them: for Store Inspector (storeInspector.ts)
// and Launch's "Copy a page's layout" (launchRun.ts, lib/pageMirror.ts).

import { firstProductPath, inspectHtml } from "./storeInspect";
import { productJsPath, teardownProductPage, vitalsOffersUrl, type Teardown } from "./storeTeardown";

// An honest bot name: Shopify answers a desktop-Chrome name that doesn't act like Chrome with 429 on
// product pages and /products/<handle>.js (seen October 2026), but serves named bots normally.
export const STORE_UA = "Mozilla/5.0 (compatible; AdSpyPro/1.0; +https://adspypro.net)";
const UA = STORE_UA;

/** Whether HTML from a plain fetch is a bot check, or an empty shell that only a browser fills in. */
export function needsBrowser(html: string): boolean {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() ?? "";
  if (/^(just a moment|attention required|access denied|checking your browser|pardon our interruption)/i.test(title)) return true;
  if (/_Incapsula_Resource|captcha-delivery\.com|px-captcha|id="challenge-form"/.test(html)) return true;
  const body = html.replace(/<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = body.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  return text.length < 150 && /<script/i.test(html);
}

/**
 * The page as our own browser sees it after its scripts have run (api/render.ts, headless Chrome on Vercel),
 * or null when the browser isn't set up (RENDER_SECRET) or the page still can't be read.
 */
export async function renderPage(url: string): Promise<string | null> {
  const secret = process.env.RENDER_SECRET?.trim();
  if (!secret) return null;
  const endpoint = process.env.RENDER_URL?.trim() || "https://adspypro.net/api/render";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn("Render: answered", res.status, new URL(url).host);
      return null;
    }
    const body = (await res.json()) as { html?: unknown; status?: unknown };
    if (typeof body.html !== "string") return null;
    // A missing page stays missing; 403/429/503 are what bot checks answer before they let the browser through.
    if (typeof body.status === "number" && body.status >= 400 && ![403, 429, 503].includes(body.status)) return null;
    return needsBrowser(body.html) ? null : body.html;
  } catch (e) {
    console.warn("Render failed", new URL(url).host, e);
    return null;
  }
}

/** A page's HTML: a plain fetch, then our browser when the server turns us away or sends a page built by scripts. */
export async function fetchPage(url: string): Promise<string | null> {
  let status = 0;
  let html: string | null = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    if (res.ok) html = (await res.text()).slice(0, 3_000_000);
  } catch {
    // No answer (timeout, refused): the browser may still get one.
  }
  if (html !== null && !needsBrowser(html)) return html;
  if (status === 404 || status === 410) return null;
  return (await renderPage(url)) ?? html;
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
