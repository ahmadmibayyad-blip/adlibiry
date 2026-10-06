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
