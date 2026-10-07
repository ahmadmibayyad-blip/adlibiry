// "Scaling" ads: running long enough to have been tested, and the seller is
// still putting budget behind them. An ad is Scaling when it has run 14+ days
// AND either its views grew 10%+ over the last week (from our own daily
// snapshots) or its engagement rate is at or above its niche's median.
// Pure, unit tested; the daily pipeline sets ads.isScaling.

export const SCALING_MIN_DAYS = 14;
export const SCALING_MIN_GROWTH = 0.1;

/** (likes + comments) ÷ views, or undefined without views. */
export function engagementRate(a: { likes?: number; comments?: number; views: number }): number | undefined {
  return a.views > 0 ? ((a.likes ?? 0) + (a.comments ?? 0)) / a.views : undefined;
}

export function isScaling(a: {
  daysRunning: number;
  viewsNow: number;
  viewsWeekAgo?: number; // latest snapshot 7+ days ago
  engagement?: number;
  nicheMedianEngagement?: number;
}): boolean {
  if (a.daysRunning < SCALING_MIN_DAYS) return false;
  const growing = a.viewsWeekAgo !== undefined && a.viewsWeekAgo > 0 && (a.viewsNow - a.viewsWeekAgo) / a.viewsWeekAgo >= SCALING_MIN_GROWTH;
  const engaging = a.engagement !== undefined && a.engagement > 0 && a.nicheMedianEngagement !== undefined && a.engagement >= a.nicheMedianEngagement;
  return growing || engaging;
}

/** Median of a list (undefined when empty). */
export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
