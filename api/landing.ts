// Vercel function for the home page "/" (see vercel.json): the built page
// (app.html, see vite.config.ts) with today's live counts written in, so
// crawlers and slow clients see real numbers. The app reads them on first
// render (src/lib/landingHtml.ts initialStats).
//
// Self-contained on purpose: Vercel runs this file as an ES module, where a
// relative import without a file extension fails at load time
// (FUNCTION_INVOCATION_FAILED). Any failure serves the plain page.

type Count = { value: string; n: number };
type LandingStats = {
  ads: { total: number; activeCount: number; countries: Count[] };
  products: { total: number; categories: Count[] };
};

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

/** The Convex URL the build wrote into the page (`<meta name="convex-url">`). */
export function convexUrlFromHtml(html: string): string | null {
  const m = html.match(/<meta name="convex-url" content="(https:\/\/[a-z0-9-]+\.convex\.cloud)"/);
  return m ? m[1] : null;
}

/** The page with the stats written in; unchanged if the stats look wrong. */
export function injectStats(html: string, stats: unknown): string {
  if (!isStats(stats) || !html.includes('<div id="root"></div>')) return html;
  const counts = (list: Count[]) => list.map((c) => ({ value: String(c?.value ?? ""), n: Number(c?.n) || 0 }));
  const safe: LandingStats = {
    ads: { total: stats.ads.total, activeCount: stats.ads.activeCount, countries: counts(stats.ads.countries) },
    products: { total: stats.products.total, categories: counts(stats.products.categories) },
  };
  const json = JSON.stringify(safe).replace(/</g, "\\u003c");
  const body = landingMarkup(safe);
  return html
    .replace("</head>", `<script>window.__ADSPY_STATS__=${json}</script></head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

// The home page's first screen exactly as Hero.tsx and StatsBar.tsx draw it before live data arrives
// (inside Index.tsx's page wrapper). React's first render then replaces it with the same markup: nothing
// jumps, and the browser counts the page as shown at first paint instead of when the app starts.
// src/pages/_components/landingMarkup.test.tsx fails when those components change; copy the new markup here.
const skeletonRow = `<li class="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0"><div class="w-12 h-12 rounded-lg bg-muted animate-pulse shrink-0"></div><div class="flex-1 space-y-2"><div class="h-3 w-3/4 rounded bg-muted animate-pulse"></div><div class="h-2.5 w-1/3 rounded bg-muted animate-pulse"></div></div></li>`;

export function landingMarkup(s: LandingStats): string {
  const ads = num(s.ads.total);
  const active = num(s.ads.activeCount);
  const products = num(s.products.total);
  const countries = num(s.ads.countries.length);
  const categories = num(s.products.categories.length);
  const hero = `<section class="pt-28 pb-20 lg:pt-36 lg:pb-28"><div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center"><div><h1 class="font-display text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.02] text-balance mb-6">Find the products that are already selling.</h1><p class="text-lg text-muted-foreground max-w-xl mb-8">AdSpy Pro watches ${ads} ads on Facebook, Instagram and TikTok, ties them to the ${products} products they sell, and scores every one. Then it tells you whether to test each one: demand, room left in your country, margin from real supplier prices, and the ad angles already working.</p><div class="flex flex-wrap items-center gap-x-5 gap-y-3"><a href="/#pricing" data-slot="button" data-variant="default" data-size="lg" class="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;_svg]:pointer-events-none [&amp;_svg]:shrink-0 [&amp;_svg:not([class*=&#x27;size-&#x27;])]:size-4 bg-primary text-primary-foreground hover:bg-primary/90 has-[&gt;svg]:px-4 h-12 px-6 text-base font-semibold rounded-xl">Start free<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right w-4 h-4" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a><a href="/#tour" class="inline-flex items-center gap-2 min-h-11 text-sm font-medium text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-4 h-4 fill-current" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path></svg>Watch the tour (1:33)</a></div></div><div class="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"><div class="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3 border-b border-border"><h2 class="font-display text-lg font-bold">Current winners</h2><span class="text-xs text-muted-foreground">New mix every 3 days</span></div><ul aria-busy="true">${skeletonRow.repeat(5)}</ul><div class="px-5 py-3 bg-muted/50 text-xs text-muted-foreground">\u00a0</div></div></div></section>`;
  const stats = `<section class="py-10 border-y border-border bg-card/40" aria-label="AdSpy Pro in numbers"><dl class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8"><div><dt class="text-sm text-muted-foreground">Ads tracked</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${ads}</dd></div><div><dt class="text-sm text-muted-foreground">Ads running now</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${active}</dd></div><div><dt class="text-sm text-muted-foreground">Products scored</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${products}</dd></div><div><dt class="text-sm text-muted-foreground">Countries</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${countries}</dd></div><div><dt class="text-sm text-muted-foreground">Categories</dt><dd class="font-display text-3xl font-bold tabular-nums mt-1">${categories}</dd></div></dl></section>`;
  return `<div class="min-h-screen bg-background text-foreground">${hero}${stats}</div>`;
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // Shared cache for 10 minutes, then refreshed in the background.
  "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
};

export async function GET(request: Request): Promise<Response> {
  let html: string;
  try {
    const page = await fetch(new URL("/app.html", request.url));
    if (!page.ok) throw new Error(`app.html ${page.status}`);
    html = await page.text();
  } catch {
    // Can't read the page: send the browser to it directly (the app routes /app.html to /).
    return new Response(null, { status: 307, headers: { location: "/app.html", "cache-control": "no-store" } });
  }
  try {
    const convexUrl = convexUrlFromHtml(html);
    if (!convexUrl) return new Response(html, { headers: HEADERS });
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "stats:get", args: {}, format: "json" }),
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { status?: string; value?: unknown };
    return new Response(body.status === "success" ? injectStats(html, body.value) : html, { headers: HEADERS });
  } catch {
    return new Response(html, { headers: HEADERS });
  }
}

// Uptime monitors and link-preview bots often ask with HEAD: same answer, no body.
export async function HEAD(request: Request): Promise<Response> {
  const res = await GET(request);
  return new Response(null, { status: res.status, headers: res.headers });
}
