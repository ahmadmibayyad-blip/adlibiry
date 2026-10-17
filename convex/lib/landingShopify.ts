// Screenshot to page → "Publish to Shopify" (screenPagesShopify.ts): the landing page as a Shopify page whose
// template shows its HTML as a whole document, without the theme's header, footer or CSS (Tailwind's reset would
// restyle the theme otherwise), optionally as the store's home page; and its dead links ("#") pointed at the
// store's pages. The theme files are also in both Launch themes (shopify-theme/, shopify-theme-dawn/). Pure.

import { LANDING_FILES } from "./landingFiles.generated";

export { LANDING_FILES };
export const LANDING_TEMPLATE_SUFFIX = "adspy-landing";

/** What to do when Shopify won't let the app add the files: add them once by hand. */
export const TEMPLATE_STEPS =
  "Shopify didn't let AdSpy add the landing page files to your live theme, so add them once yourself: Online Store → Themes → ⋯ → Edit code → " +
  "add each file below (in Layout, Templates and Sections) with that name and content → Save. Then publish again.";

/** The home page template that shows a landing page (by handle) instead of the theme's home page. */
export function homeTemplate(handle: string): string {
  return JSON.stringify({ layout: "adspy-landing", sections: { main: { type: "adspy-landing-home", settings: { page: handle } } }, order: ["main"] }, null, 2);
}

/** A home page template AdSpy wrote (so it never replaces the backup of the theme's own). */
export const isLandingHome = (content: string) => content.includes('"adspy-landing-home"');

/** The page as sent to Shopify: starting with exactly the doctype the layout looks for. */
export function withDoctype(html: string): string {
  return `<!DOCTYPE html>\n${html.replace(/^\s*<!doctype[^>]*>\s*/i, "")}`;
}

// ── Links that go nowhere get the store's pages ──

export type DeadLink = { i: number; text: string; area: "menu" | "footer" | "page" };

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /\bhref\s*=\s*(["'])(.*?)\1/i;
const hrefOf = (attrs: string) => attrs.match(HREF)?.[2];
const attrOf = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "";
const isDead = (href: string | undefined) => href === undefined || href === "" || href === "#" || /^javascript:/i.test(href);
const plainText = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function spans(html: string, tag: string): [number, number][] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"))].map((m) => [m.index, m.index + m[0].length]);
}

/** Every link on the page that goes nowhere, numbered in page order (all links count), with its text and where it sits. */
export function deadLinks(html: string): DeadLink[] {
  const menu = [...spans(html, "header"), ...spans(html, "nav")];
  const footer = spans(html, "footer");
  const inside = (at: number, list: [number, number][]) => list.some(([a, b]) => at >= a && at < b);
  const out: DeadLink[] = [];
  let i = 0;
  for (const m of html.matchAll(ANCHOR)) {
    const n = i++;
    if (!isDead(hrefOf(m[1]))) continue;
    const text = (plainText(m[2]) || attrOf(m[1], "aria-label") || attrOf(m[1], "title")).slice(0, 80);
    out.push({ i: n, text: text || "(icon)", area: inside(m.index, footer) ? "footer" : inside(m.index, menu) ? "menu" : "page" });
  }
  return out;
}

/** The page with link number i (deadLinks' numbering) going to urls[i]. */
export function setLinks(html: string, urls: Record<number, string>): string {
  let i = 0;
  return html.replace(ANCHOR, (whole, attrs: string, inner: string) => {
    const url = urls[i++];
    if (!url) return whole;
    const safe = url.replace(/"/g, "%22");
    const next = hrefOf(attrs) !== undefined ? attrs.replace(HREF, `href="${safe}"`) : ` href="${safe}"${attrs}`;
    return `<a${next}>${inner}</a>`;
  });
}

export type StoreLink = { label: string; url: string };

/** A store link as a path on the store ("/collections/all"); null when it leads off the store. */
export function storePath(url: string, shopHosts: string[]): string | null {
  try {
    const u = new URL(url, "https://store.invalid");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.hostname !== "store.invalid" && !shopHosts.includes(u.hostname.toLowerCase())) return null;
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** The links every store has, then its menus, collections, pages and products, without repeats. */
export function storeLinks(found: { menus: StoreLink[]; collections: StoreLink[]; pages: StoreLink[]; products: StoreLink[] }): StoreLink[] {
  const all = [
    { label: "Home page", url: "/" },
    { label: "All products", url: "/collections/all" },
    { label: "Cart", url: "/cart" },
    { label: "Search", url: "/search" },
    { label: "Customer account", url: "/account" },
    ...found.menus,
    ...found.collections.map((l) => ({ ...l, label: `Collection: ${l.label}` })),
    ...found.pages.map((l) => ({ ...l, label: `Page: ${l.label}` })),
    ...found.products.map((l) => ({ ...l, label: `Product: ${l.label}` })),
  ];
  const seen = new Set<string>();
  return all.filter((l) => !seen.has(l.url) && !!seen.add(l.url));
}

export const LINKS_GUIDE =
  "You connect a landing page's links to an online store. You get the store's links (label: path) and the page's links that go nowhere " +
  "(number, where it sits, its text). For each, pick the store path it should open: menu bar items the matching menu link, collection or page " +
  "(in any language); shop and buy buttons the product the page sells, else all products; cart, search and account icons /cart, /search and " +
  "/account; the logo the home page. Use only paths from the list; null when nothing fits (e.g. social media icons).";

export function linksPrompt(links: StoreLink[], dead: DeadLink[]): string {
  return [
    "The store's links:",
    ...links.map((l) => `- ${l.label}: ${l.url}`),
    "",
    "The page's links that go nowhere:",
    ...dead.map((d) => `${d.i}. [${d.area}] ${d.text}`),
  ].join("\n");
}

/** The AI's picks, checked: only links that go nowhere, and only paths the store has. */
export function pickedLinks(answer: { links: { i: number; url: string | null }[] } | null, dead: DeadLink[], links: StoreLink[]): Record<number, string> {
  const ok = new Set(links.map((l) => l.url));
  const open = new Set(dead.map((d) => d.i));
  const out: Record<number, string> = {};
  for (const l of answer?.links ?? []) if (l.url && open.has(l.i) && ok.has(l.url)) out[l.i] = l.url;
  return out;
}
