// Server-side numbers for the home page (written by api/landing.ts on Vercel).
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
