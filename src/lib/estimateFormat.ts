import { compactNumber } from "@/lib/adFormat.ts";

type Range = { low: number; high: number } | undefined;

const usd = (n: number) => (n >= 1000 ? `$${compactNumber(n)}` : `$${Math.round(n)}`);

// "~$1.2K–$3.6K" (or one number when low = high).
export function rangeLabel(r: Range, money = false): string | undefined {
  if (!r || r.high <= 0) return undefined;
  const f = money ? usd : (n: number) => compactNumber(n);
  return r.low === r.high ? f(r.high) : `~${f(r.low)}–${f(r.high)}`;
}

export const BASIS_TEXT: Record<string, string> = {
  reported: "Reported by the ad platform",
  engagement: "Estimated from likes and comments (1–3% of viewers engage)",
  spend: "Estimated from ad spend at a $6–$15 CPM",
  impressions: "Estimated from impressions at a $6–$15 CPM",
  reported_gmv: "From reported TikTok Shop sales (GMV)",
  marketplace_sales: "From the marketplace's own sales counts × price",
  ad_funnel: "Estimated: monthly impressions × 0.8–1.5% clicks × 1–3% conversion × price",
};
