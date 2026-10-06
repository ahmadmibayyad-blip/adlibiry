import { compactNumber } from "@/lib/adFormat.ts";
import { pointEstimate, revenueConfidence, type Confidence } from "@/convex/lib/estimates.ts";

type Range = { low: number; high: number } | undefined;

const usd = (n: number) => (n >= 1000 ? `$${compactNumber(n)}` : `$${Math.round(n)}`);

// One number for an estimate ("~$737K"), never a wide range; exact when the
// source reported it (low = high).
export function estimateLabel(r: Range, money = false): string | undefined {
  const n = pointEstimate(r);
  if (n === undefined || !r) return undefined;
  const f = money ? usd : (x: number) => compactNumber(x);
  return r.low === r.high ? f(n) : `~${f(n)}`;
}

// Monthly revenue as one number plus how sure we are (lib/estimates.ts).
export function revenueEstimate(p: { estRevenue?: Range; estBasis?: { revenue?: string } }): { label: string; confidence?: Confidence } | undefined {
  const label = estimateLabel(p.estRevenue, true);
  return label ? { label, confidence: revenueConfidence(p.estBasis?.revenue) } : undefined;
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
