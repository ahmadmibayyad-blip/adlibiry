// Vercel function for the home page "/" (see vercel.json): the built page
// (app.html, see vite.config.ts) with today's live counts written in, so crawlers and slow
// clients see real numbers (src/lib/landingHtml.ts). Any failure serves the
// plain page, exactly as before.
import { convexUrlFromHtml, injectStats } from "../src/lib/landingHtml";

async function landingPage(request: Request): Promise<Response> {
  const page = await fetch(new URL("/app.html", request.url));
  const html = await page.text();
  const headers = {
    "content-type": "text/html; charset=utf-8",
    // Shared cache for 10 minutes, then refreshed in the background.
    "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
  };
  try {
    const convexUrl = convexUrlFromHtml(html);
    if (!convexUrl) return new Response(html, { headers });
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "stats:get", args: {}, format: "json" }),
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { status?: string; value?: unknown };
    return new Response(body.status === "success" ? injectStats(html, body.value) : html, { headers });
  } catch {
    return new Response(html, { headers });
  }
}

export function GET(request: Request) {
  return landingPage(request);
}
