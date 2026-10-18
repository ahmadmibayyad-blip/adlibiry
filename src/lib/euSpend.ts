// EU-reach spend estimate for the app; the rule itself is in
// convex/lib/euSpend.ts so Ad Spy's filters and cards agree.
import { clampCpm, DEFAULT_CPM, spendFromReach, type SpendSource } from "@/convex/lib/euSpend.ts";

export { clampCpm, CPM_MAX, CPM_MIN, DEFAULT_CPM, spendFromReach } from "@/convex/lib/euSpend.ts";

// The user's CPM, kept in this browser (see hooks/use-cpm.ts).
export const CPM_STORAGE_KEY = "adspy-cpm";

export function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 10) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

export function readCpm(): number {
  try {
    const raw = localStorage.getItem(CPM_STORAGE_KEY);
    return raw === null ? DEFAULT_CPM : clampCpm(raw);
  } catch {
    return DEFAULT_CPM;
  }
}

// What an ad shows as its spend: the EU-reach estimate when the ad has EU
// reach (same rule for every source), else the source's own figure.
export function adSpend(ad: SpendSource, cpm: number = DEFAULT_CPM, sourceLabel?: (s: string | undefined) => string | null) {
  const reach = ad.audience?.totalReach;
  const fromReach = spendFromReach(reach, cpm);
  if (fromReach !== undefined) {
    return { value: formatUsd(fromReach), usd: fromReach, basis: "eu-reach" as const, note: `EU reach ${Math.round(reach!).toLocaleString("en-US")} × $${clampCpm(cpm)} CPM` };
  }
  const fromSource = sourceLabel?.(ad.spendEstimate) ?? null;
  return fromSource ? { value: fromSource, usd: undefined, basis: "source" as const, note: undefined } : null;
}
