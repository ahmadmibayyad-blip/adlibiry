// An ad's rank among its advertiser's live ads, by views (most first; longer
// running first on a tie). Advertisers keep their best creatives running and
// spend on them, so climbing to #1 is a strong scaling signal. Saved on the ad
// every night (productPipeline "rankAds") and copied into dailySnapshots, so
// the ad page can chart it day by day. Pure, tested in adRank.test.ts.

// Ads without a page name all share this: they aren't one advertiser.
export const UNKNOWN_ADVERTISER = "Unknown advertiser";

// One advertiser's ads read at most per night; past that, ranks come from the first ones read.
export const MAX_ADS_PER_ADVERTISER = 500;

export type RankInput = { id: string; isActive?: boolean; views: number; daysRunning: number };
export type Rank = { rank: number; of: number };

/** Rank of each live ad (1 = most views); stopped ads aren't in the map. */
export function rankAdvertiserAds(ads: RankInput[]): Map<string, Rank> {
  const live = ads
    .filter((a) => a.isActive !== false)
    .sort((a, b) => b.views - a.views || b.daysRunning - a.daysRunning || a.id.localeCompare(b.id));
  return new Map(live.map((a, i) => [a.id, { rank: i + 1, of: live.length }]));
}

/** "Rising" when the rank improved by 1+ places over the window, "falling" when it dropped. */
export function rankTrend(points: { rank?: number }[]): "rising" | "falling" | "steady" | undefined {
  const ranked = points.filter((p): p is { rank: number } => typeof p.rank === "number");
  if (ranked.length < 2) return undefined;
  const diff = ranked[0].rank - ranked[ranked.length - 1].rank;
  return diff > 0 ? "rising" : diff < 0 ? "falling" : "steady";
}
