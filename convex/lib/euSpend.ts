// Estimated ad spend from EU reach, the way Minea and WinningHunter do it:
// Meta publishes each EU ad's reach (DSA transparency), not its spend, so
// spend = reach ÷ 1,000 × CPM. Minea uses a flat $9 CPM, WinningHunter $11.
// The CPM is the user's own setting; the app and ads.list share this rule.
import { parseRangeUpperBound } from "./rangeParsing";

export const DEFAULT_CPM = 9;
export const CPM_MIN = 1;
export const CPM_MAX = 100;

export function clampCpm(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CPM;
  return Math.min(CPM_MAX, Math.max(CPM_MIN, Math.round(v * 100) / 100));
}

// USD, or undefined when there's no reach to work from.
export function spendFromReach(reach: number | undefined | null, cpm: number = DEFAULT_CPM): number | undefined {
  if (!reach || !Number.isFinite(reach) || reach <= 0) return undefined;
  return (reach / 1000) * clampCpm(cpm);
}

export type SpendSource = { spendEstimate?: string; audience?: { totalReach?: number } | null };

// The spend figure an ad is filtered and sorted by: the EU-reach estimate
// when the ad has EU reach, else the top of the source's own range.
export function estimatedSpendUsd(ad: SpendSource, cpm: number = DEFAULT_CPM): number | undefined {
  return spendFromReach(ad.audience?.totalReach, cpm) ?? parseRangeUpperBound(ad.spendEstimate ?? "");
}
