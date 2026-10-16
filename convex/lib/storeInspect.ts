// Store Inspector (convex/storeInspector.ts): which theme and apps a Shopify
// store runs, read from its public pages: the Shopify.theme object, theme app
// embeds (shopify://apps/<handle>/…), app extension assets
// (cdn.shopify.com/extensions/<id>/<name>-<version>), app script hosts and ad
// pixels. Pure and unit tested.

import type { Teardown } from "./storeTeardown";
import type { StoreHistory } from "./storeHistory";

export type AppCategory =
  | "Bundles & upsells"
  | "Cart"
  | "Reviews"
  | "Email & SMS"
  | "Conversion"
  | "Order tracking"
  | "A/B testing"
  | "Page builder"
  | "Payments"
  | "Subscriptions"
  | "Support"
  | "Translation & currency"
  | "Analytics"
  | "Loyalty"
  | "Other";

export type InspectedApp = {
  /** Our key: the App Store handle when we know it, else the detected name. */
  key: string;
  name: string;
  category: AppCategory;
  /** App Store page, when the handle is known to be one. */
  url?: string;
  /** What gave it away: "app embed", "app extension", "script". */
  via: string;
};

export type InspectedTheme = {
  /** The name the owner gave this copy ("Needyknee – Halloween"). */
  name: string;
  /** The theme it's built on ("Cello"), its version and Theme Store id (null for uploaded copies). */
  schemaName?: string;
  version?: string;
  themeStoreId?: number | null;
  vendor?: string;
  free?: boolean;
  url?: string;
};

export type Inspection = {
  shopify: boolean;
  shopName?: string;
  myshopifyDomain?: string;
  country?: string;
  currency?: string;
  locale?: string;
  theme?: InspectedTheme;
  apps: InspectedApp[];
  pixels: string[];
  /** The main product page's teardown (lib/storeTeardown.ts); null when no product page could be read. */
  teardown?: Teardown | null;
  /** When the Wayback Machine saved the store (lib/storeHistory.ts); null when the archive didn't answer in time. */
  history?: StoreHistory | null;
};

type AppInfo = { name: string; category: AppCategory; handle?: string };

/** App Store handle (as in shopify://apps/<handle>) → app. */
const APPS_BY_HANDLE: Record<string, AppInfo> = {
  "kaching-bundles": { name: "Kaching Bundles", category: "Bundles & upsells" },
  "xboost-bundle": { name: "Xboost Bundles", category: "Bundles & upsells" },
  "bundler-pro": { name: "Bundler", category: "Bundles & upsells" },
  "fast-bundle": { name: "Fast Bundle", category: "Bundles & upsells" },
  "frequently-bought-together": { name: "Frequently Bought Together", category: "Bundles & upsells" },
  "selleasy": { name: "Selleasy", category: "Bundles & upsells" },
  "reconvert-upsell-cross-sell": { name: "ReConvert", category: "Bundles & upsells" },
  "aftersell": { name: "AfterSell", category: "Bundles & upsells" },
  "zipify-oneclickupsell": { name: "Zipify OCU", category: "Bundles & upsells" },
  "upcart-cart-builder": { name: "UpCart", category: "Cart" },
  "monster-cart-upsell-free-gift": { name: "Monster Cart", category: "Cart" },
  "slide-cart-drawer": { name: "Slide Cart", category: "Cart" },
  "judgeme": { name: "Judge.me", category: "Reviews" },
  "loox": { name: "Loox", category: "Reviews" },
  "okendo": { name: "Okendo", category: "Reviews" },
  "trustpilot-reviews": { name: "Trustpilot", category: "Reviews" },
  "reviews-io": { name: "REVIEWS.io", category: "Reviews" },
  "product-reviews-addon": { name: "Ali Reviews", category: "Reviews" },
  "yotpo-social-reviews": { name: "Yotpo Reviews", category: "Reviews" },
  "stamped": { name: "Stamped", category: "Reviews" },
  "klaviyo-email-marketing-sms": { name: "Klaviyo", category: "Email & SMS" },
  "klaviyo-email-marketing": { name: "Klaviyo", category: "Email & SMS" },
  "omnisend": { name: "Omnisend", category: "Email & SMS" },
  "privy": { name: "Privy", category: "Email & SMS" },
  "postscript-sms-marketing": { name: "Postscript", category: "Email & SMS" },
  "attentive": { name: "Attentive", category: "Email & SMS" },
  "vitals": { name: "Vitals", category: "Conversion" },
  "hextom-free-shipping-bar": { name: "Free Shipping Bar", category: "Conversion" },
  "essential-countdown-timer": { name: "Essential Countdown Timer", category: "Conversion" },
  "hurrify-countdown-timer": { name: "Hurrify", category: "Conversion" },
  "trust-badges-bear": { name: "Trust Badges Bear", category: "Conversion" },
  "trackpanda": { name: "Trackpanda", category: "Order tracking" },
  "parcel-panel": { name: "Parcel Panel", category: "Order tracking" },
  "aftership": { name: "AfterShip Tracking", category: "Order tracking" },
  "track123": { name: "Track123", category: "Order tracking" },
  "intelligems-a-b-testing": { name: "Intelligems", category: "A/B testing" },
  "shoplift": { name: "Shoplift", category: "A/B testing" },
  "section-factory": { name: "Section Factory", category: "Page builder" },
  "shogun": { name: "Shogun", category: "Page builder" },
  "gempages": { name: "GemPages", category: "Page builder" },
  "pagefly": { name: "PageFly", category: "Page builder" },
  "replo": { name: "Replo", category: "Page builder" },
  "zipify-pages": { name: "Zipify Pages", category: "Page builder" },
  "klarna-on-site-messaging": { name: "Klarna On-site Messaging", category: "Payments" },
  "afterpay-on-site-messaging": { name: "Afterpay Messaging", category: "Payments" },
  "recharge": { name: "Recharge Subscriptions", category: "Subscriptions" },
  "appstle-subscriptions": { name: "Appstle Subscriptions", category: "Subscriptions" },
  "gorgias": { name: "Gorgias", category: "Support" },
  "tidio-chat": { name: "Tidio", category: "Support" },
  "zendesk": { name: "Zendesk", category: "Support" },
  "weglot": { name: "Weglot", category: "Translation & currency" },
  "langify": { name: "Langify", category: "Translation & currency" },
  "transcy-multiple-languages": { name: "Transcy", category: "Translation & currency" },
  "triple-whale-1": { name: "Triple Whale", category: "Analytics" },
  "lucky-orange": { name: "Lucky Orange", category: "Analytics" },
  "hotjar": { name: "Hotjar", category: "Analytics" },
  "smile-io": { name: "Smile", category: "Loyalty" },
  "loyaltylion": { name: "LoyaltyLion", category: "Loyalty" },
};

/** App extension name (cdn.shopify.com/extensions/<id>/<name>-<version>) → App Store handle. */
const EXTENSIONS: Record<string, string> = {
  "upcart-2": "upcart-cart-builder",
  "kaching-bundles": "kaching-bundles",
  "trackpanda": "trackpanda",
  "section-factory": "section-factory",
  "klarna-on-site-messaging": "klarna-on-site-messaging",
  "judgeme-extensions": "judgeme",
  "loox-extension": "loox",
  "vitals": "vitals",
};

/** Script host (or a part of it) → App Store handle. */
const HOSTS: [RegExp, string][] = [
  [/(^|\.)klaviyo\.com$/, "klaviyo-email-marketing-sms"],
  [/(^|\.)vitals\.app$/, "vitals"],
  [/(^|\.)intelligems\.io$/, "intelligems-a-b-testing"],
  [/(^|\.)loox\.io$/, "loox"],
  [/(^|\.)okendo\.io$/, "okendo"],
  [/(^|\.)judge\.me$/, "judgeme"],
  [/(^|\.)trustpilot\.com$/, "trustpilot-reviews"],
  [/(^|\.)reviews\.io$/, "reviews-io"],
  [/(^|\.)stamped\.io$/, "stamped"],
  [/(^|\.)yotpo\.com$/, "yotpo-social-reviews"],
  [/(^|\.)omnisend(rv)?\.com$/, "omnisend"],
  [/(^|\.)privy\.com$/, "privy"],
  [/(^|\.)gorgias\.chat$/, "gorgias"],
  [/(^|\.)tidio\.co$/, "tidio-chat"],
  [/(^|\.)weglot\.com$/, "weglot"],
  [/(^|\.)rechargecdn\.com$/, "recharge"],
  [/(^|\.)smile\.io$/, "smile-io"],
  [/(^|\.)luckyorange\.(com|net)$/, "lucky-orange"],
  [/(^|\.)hotjar\.com$/, "hotjar"],
  [/(^|\.)gempages\.net$/, "gempages"],
  [/(^|\.)pagefly\.io$/, "pagefly"],
  [/(^|\.)aftership\.com$/, "aftership"],
  [/(^|\.)parcelpanel\.com$/, "parcel-panel"],
  [/(^|\.)triplewhale\.com$/, "triple-whale-1"],
];

const PIXELS: [RegExp, string][] = [
  // Shopify's web pixel settings name Meta's pixel ("pixel_type":"facebook_pixel"); others load their scripts.
  [/connect\.facebook\.net|fbq\(|facebook_pixel/i, "Meta (Facebook) pixel"],
  [/analytics\.tiktok\.com|ttq\.load|\\"pixelCode\\"/i, "TikTok pixel"],
  [/googletagmanager\.com|gtag\(|google-analytics\.com|\\"(?:G|AW)-[A-Z0-9]{6,}/, "Google (Analytics / Ads)"],
  [/sc-static\.net|snaptr\(/i, "Snapchat pixel"],
  [/ct\.pinterest\.com|pintrk\(/i, "Pinterest tag"],
];

/** Themes we know: schema_name → vendor and whether it's one of Shopify's free themes. */
const THEMES: Record<string, { vendor: string; free?: boolean; slug?: string }> = {
  Dawn: { vendor: "Shopify", free: true, slug: "dawn" },
  Horizon: { vendor: "Shopify", free: true, slug: "horizon" },
  Refresh: { vendor: "Shopify", free: true, slug: "refresh" },
  Sense: { vendor: "Shopify", free: true, slug: "sense" },
  Craft: { vendor: "Shopify", free: true, slug: "craft" },
  Studio: { vendor: "Shopify", free: true, slug: "studio" },
  Taste: { vendor: "Shopify", free: true, slug: "taste" },
  Crave: { vendor: "Shopify", free: true, slug: "crave" },
  Colorblock: { vendor: "Shopify", free: true, slug: "colorblock" },
  Ride: { vendor: "Shopify", free: true, slug: "ride" },
  Origin: { vendor: "Shopify", free: true, slug: "origin" },
  Spotlight: { vendor: "Shopify", free: true, slug: "spotlight" },
  Trade: { vendor: "Shopify", free: true, slug: "trade" },
  Publisher: { vendor: "Shopify", free: true, slug: "publisher" },
  Debut: { vendor: "Shopify", free: true },
  Cello: { vendor: "Webibazaar Templates", slug: "cello" },
  Impulse: { vendor: "Archetype Themes", slug: "impulse" },
  Motion: { vendor: "Archetype Themes", slug: "motion" },
  Streamline: { vendor: "Archetype Themes", slug: "streamline" },
  Prestige: { vendor: "Maestrooo", slug: "prestige" },
  Impact: { vendor: "Maestrooo", slug: "impact" },
  Focal: { vendor: "Maestrooo", slug: "focal" },
  Warehouse: { vendor: "Maestrooo", slug: "warehouse" },
  Symmetry: { vendor: "Clean Canvas", slug: "symmetry" },
  Broadcast: { vendor: "Invisible Themes", slug: "broadcast" },
  Pipeline: { vendor: "Groupthought", slug: "pipeline" },
  Palo_Alto: { vendor: "Presidio Creative", slug: "palo-alto" },
  Empire: { vendor: "Pixel Union", slug: "empire" },
  "Be Yours": { vendor: "RoarTheme", slug: "be-yours" },
  Turbo: { vendor: "Out of the Sandbox" },
  Booster: { vendor: "Booster Apps" },
  Shrine: { vendor: "Shrine Themes" },
  "Shrine PRO": { vendor: "Shrine Themes" },
  Debutify: { vendor: "Debutify" },
};

const prettify = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function app(handle: string, via: string, fallbackName?: string): InspectedApp {
  const known = APPS_BY_HANDLE[handle];
  if (known) return { key: handle, name: known.name, category: known.category, url: `https://apps.shopify.com/${handle}`, via };
  return { key: handle, name: fallbackName ?? prettify(handle), category: "Other", ...(fallbackName ? {} : { url: `https://apps.shopify.com/${handle}` }), via };
}

function jsonObject(html: string, marker: string): Record<string, unknown> | undefined {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const start = html.indexOf("{", at);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length && i < start + 5000; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const quoted = (html: string, re: RegExp) => html.match(re)?.[1];

/** One page's findings. Combine several pages with mergeInspections. */
export function inspectHtml(html: string): Inspection {
  const shopify = /cdn\.shopify\.com|Shopify\.shop\s*=|shopify-features/.test(html);
  const t = jsonObject(html, "Shopify.theme =");
  let theme: InspectedTheme | undefined;
  if (t) {
    const schemaName = str(t.schema_name);
    const known = schemaName ? (THEMES[schemaName] ?? THEMES[schemaName.replace(/\s+/g, "_")]) : undefined;
    theme = {
      name: str(t.name) ?? schemaName ?? "Unknown",
      ...(schemaName ? { schemaName } : {}),
      ...(str(t.schema_version) ? { version: str(t.schema_version) } : {}),
      themeStoreId: typeof t.theme_store_id === "number" ? t.theme_store_id : null,
      ...(known ? { vendor: known.vendor, free: !!known.free } : {}),
      ...(known?.slug ? { url: `https://themes.shopify.com/themes/${known.slug}` } : {}),
    };
  }

  const apps = new Map<string, InspectedApp>();
  const add = (a: InspectedApp) => {
    if (!apps.has(a.key)) apps.set(a.key, a);
  };
  for (const m of html.matchAll(/shopify:\/\/apps\/([a-z0-9-]+)\/blocks\//g)) add(app(m[1], "app embed"));
  for (const m of html.matchAll(/cdn\.shopify\.com\/extensions\/[0-9a-f-]+\/([a-z0-9-]+?)-(\d+(?:\.\d+)*)\//g)) {
    const handle = EXTENSIONS[m[1]];
    add(handle ? app(handle, "app extension") : app(m[1], "app extension", prettify(m[1])));
  }
  const hosts = new Set([...html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'?:])/gi)].map((m) => m[1].toLowerCase()));
  for (const host of hosts) for (const [re, handle] of HOSTS) if (re.test(host)) add(app(handle, "script"));

  // Web pixels (Shopify's customer events) list app pixels too, and sandboxed ones name the platform.
  const pixels = PIXELS.filter(([re]) => re.test(html)).map(([, name]) => name);

  return {
    shopify,
    ...(quoted(html, /Shopify\.shop\s*=\s*"([^"]+)"/) ? { myshopifyDomain: quoted(html, /Shopify\.shop\s*=\s*"([^"]+)"/) } : {}),
    ...(quoted(html, /Shopify\.country\s*=\s*"([^"]+)"/) ? { country: quoted(html, /Shopify\.country\s*=\s*"([^"]+)"/) } : {}),
    ...(quoted(html, /Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/) ? { currency: quoted(html, /Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/) } : {}),
    ...(quoted(html, /Shopify\.locale\s*=\s*"([^"]+)"/) ? { locale: quoted(html, /Shopify\.locale\s*=\s*"([^"]+)"/) } : {}),
    ...(quoted(html, /<meta property="og:site_name" content="([^"]+)"/) ? { shopName: decode(quoted(html, /<meta property="og:site_name" content="([^"]+)"/)!) } : {}),
    ...(theme ? { theme } : {}),
    apps: [...apps.values()],
    pixels,
  };
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The home page and a product page together: apps often only load on one of them. */
export function mergeInspections(pages: Inspection[]): Inspection {
  const [first, ...rest] = pages;
  const out: Inspection = { ...first, apps: [...first.apps], pixels: [...first.pixels] };
  for (const p of rest) {
    out.shopify ||= p.shopify;
    for (const k of ["shopName", "myshopifyDomain", "country", "currency", "locale", "theme"] as const) if (!out[k] && p[k]) Object.assign(out, { [k]: p[k] });
    for (const a of p.apps) if (!out.apps.some((x) => x.key === a.key)) out.apps.push(a);
    for (const px of p.pixels) if (!out.pixels.includes(px)) out.pixels.push(px);
  }
  const order: AppCategory[] = ["Bundles & upsells", "Cart", "Reviews", "Conversion", "Email & SMS", "Order tracking", "A/B testing", "Page builder", "Payments", "Subscriptions", "Support", "Translation & currency", "Analytics", "Loyalty", "Other"];
  out.apps.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
  return out;
}

/** A product page link from the home page, to inspect too. */
export function firstProductPath(html: string): string | undefined {
  return html.match(/href="(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^"/]+\/)?products\/[^"?#/]+)/i)?.[1];
}
