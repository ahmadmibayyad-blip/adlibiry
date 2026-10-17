// Store Inspector → speed: Google PageSpeed Insights (PAGESPEED_API_KEY, free: Google Cloud → APIs → PageSpeed
// Insights API → key). One run loads the page in Lighthouse on a phone or a desktop (20-40 s). Pure.

export type SpeedRun = {
  score: number; // 0-100, Lighthouse performance
  /** Time until the main content shows (Largest Contentful Paint), seconds. */
  lcp?: number;
  fcp?: number;
  /** Visual stability (Cumulative Layout Shift). */
  cls?: number;
  /** What real visitors got (Chrome's field data): FAST | AVERAGE | SLOW, when Google has enough of them. */
  realUsers?: string;
};

export const pageSpeedUrl = (url: string, strategy: "mobile" | "desktop", key: string) =>
  `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${new URLSearchParams({ url, strategy, category: "performance", key })}`;

const seconds = (ms: unknown) => (typeof ms === "number" && ms >= 0 ? Math.round(ms / 100) / 10 : undefined);

export function speedRun(body: unknown): SpeedRun | null {
  const b = body as {
    lighthouseResult?: { categories?: { performance?: { score?: number | null } }; audits?: Record<string, { numericValue?: number }> };
    loadingExperience?: { overall_category?: string };
  } | null;
  const score = b?.lighthouseResult?.categories?.performance?.score;
  if (typeof score !== "number") return null;
  const audits = b?.lighthouseResult?.audits ?? {};
  const cls = audits["cumulative-layout-shift"]?.numericValue;
  const real = b?.loadingExperience?.overall_category;
  const lcp = seconds(audits["largest-contentful-paint"]?.numericValue);
  const fcp = seconds(audits["first-contentful-paint"]?.numericValue);
  return {
    score: Math.round(score * 100),
    ...(lcp !== undefined ? { lcp } : {}),
    ...(fcp !== undefined ? { fcp } : {}),
    ...(typeof cls === "number" ? { cls: Math.round(cls * 1000) / 1000 } : {}),
    ...(real && real !== "NONE" ? { realUsers: real } : {}),
  };
}

/** Google's bands: 90+ good, 50-89 needs work, below 50 poor. */
export const speedBand = (score: number): "good" | "ok" | "poor" => (score >= 90 ? "good" : score >= 50 ? "ok" : "poor");
