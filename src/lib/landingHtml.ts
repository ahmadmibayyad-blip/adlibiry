// Server-side numbers for the home page (used by api/landing.ts on Vercel).
// The app is a single-page app, so crawlers and slow clients would otherwise
// see an empty page or "…" until the JavaScript loads. The function writes the
// live counts into index.html twice: as plain HTML inside #root (replaced by
// React on load) and as window.__ADSPY_STATS__ for the first render.

// The part of stats.get the home page uses (lists are { value, n } counts).
type Count = { value: string; n: number };
export type LandingStats = {
  ads: { total: number; activeCount: number; countries: Count[] };
  products: { total: number; categories: Count[] };
};

declare global {
  interface Window {
    __ADSPY_STATS__?: LandingStats;
  }
}

/** Stats the server wrote into the page, if any (undefined in dev or when the function fell back). */
export function initialStats(): LandingStats | undefined {
  return typeof window === "undefined" ? undefined : window.__ADSPY_STATS__;
}

const num = (n: number) => n.toLocaleString("en-US");

function isStats(v: unknown): v is LandingStats {
  const s = v as LandingStats | null;
  return (
    !!s &&
    typeof s.ads?.total === "number" &&
    typeof s.ads.activeCount === "number" &&
    Array.isArray(s.ads.countries) &&
    typeof s.products?.total === "number" &&
    Array.isArray(s.products.categories)
  );
}

/** The Convex URL the build wrote into index.html (`<meta name="convex-url">`). */
export function convexUrlFromHtml(html: string): string | null {
  const m = html.match(/<meta name="convex-url" content="(https:\/\/[a-z0-9-]+\.convex\.cloud)"/);
  return m ? m[1] : null;
}

/** index.html with the stats written in; unchanged if the stats look wrong. */
export function injectStats(html: string, stats: unknown): string {
  if (!isStats(stats) || !html.includes('<div id="root"></div>')) return html;
  const counts = (list: Count[]) => list.map((c) => ({ value: String(c?.value ?? ""), n: Number(c?.n) || 0 }));
  const safe: LandingStats = {
    ads: { total: stats.ads.total, activeCount: stats.ads.activeCount, countries: counts(stats.ads.countries) },
    products: { total: stats.products.total, categories: counts(stats.products.categories) },
  };
  const json = JSON.stringify(safe).replace(/</g, "\\u003c");
  const items: [string, number][] = [
    ["Ads tracked", safe.ads.total],
    ["Ads running now", safe.ads.activeCount],
    ["Products scored", safe.products.total],
    ["Countries", safe.ads.countries.length],
    ["Niches", safe.products.categories.length],
  ];
  const body =
    `<div class="max-w-6xl mx-auto px-4 pt-28 pb-10">` +
    `<h1 class="font-display text-5xl font-extrabold tracking-tight mb-6">Find the products that are already selling.</h1>` +
    `<p class="text-lg text-muted-foreground max-w-xl mb-8">AdSpy Pro watches ${num(safe.ads.total)} ads on Facebook, Instagram and TikTok, ` +
    `ties them to the ${num(safe.products.total)} products they sell, and scores every one.</p>` +
    `<dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">` +
    items.map(([label, value]) => `<div><dt class="text-sm text-muted-foreground">${label}</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${num(value)}</dd></div>`).join("") +
    `</dl></div>`;
  return html
    .replace("</head>", `<script>window.__ADSPY_STATS__=${json}</script></head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}
