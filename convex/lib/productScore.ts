// Product score, model v2: five visible parts (0–100 each) combined into a raw
// score, then calibrated across the whole catalog by rank so the numbers mean
// something: median ≈ 45, top 20% ≥ 70, top 5% ≥ 85, 90+ only for the top ~1.5%.
// The daily pipeline (convex/productPipeline.ts) computes the parts, builds a
// histogram of raw scores, then maps each product's percentile to its score.

export type ScoreParts = { momentum: number; revenue: number; trend: number; saturation: number; margin: number };

// How much each part counts (sums to 1). Shown next to the breakdown.
export const SCORE_WEIGHTS: ScoreParts = { momentum: 0.3, revenue: 0.3, trend: 0.15, saturation: 0.15, margin: 0.1 };

export const SCORE_PART_LABELS: Record<keyof ScoreParts, { label: string; hint: string }> = {
  momentum: { label: "Ad momentum", hint: "How many ads are running now, how long they've run and how strong they are" },
  revenue: { label: "Revenue", hint: "Estimated monthly sales" },
  trend: { label: "Trend", hint: "Change in views over the last weeks" },
  saturation: { label: "Low competition", hint: "Fewer different advertisers selling it scores higher" },
  margin: { label: "Margin", hint: "Price minus supplier cost, when both are known" },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (x: number) => Math.round(clamp01(x) * 100);

export type ScoreInput = {
  activeAds: number;          // ads running now (linked ads, or the source's ad count)
  medianDaysRunning?: number; // of the linked ads
  sourceScore?: number;       // 0–100 strength signal from the importer / best ad
  revenuePerMonth?: number;   // point estimate, USD
  growthPercent?: number;     // views change over the last weeks
  trend?: string;             // "Rising" | "Stable" | "Declining" | "Unknown"
  saturation?: string;        // "Low" | "Medium" | "High" | "Unknown"
  marginPercent?: number;
};

export function scoreParts(i: ScoreInput): ScoreParts {
  // Ad count on a log scale: 1 ad ≈ 0.21, 5 ≈ 0.55, 25+ = 1.
  const adCount = clamp01(Math.log(1 + i.activeAds) / Math.log(26));
  const longevity = i.medianDaysRunning === undefined ? 0.3 : clamp01(i.medianDaysRunning / 60);
  const strength = i.sourceScore === undefined ? 0.3 : clamp01(i.sourceScore / 100);
  const momentum = i.activeAds > 0 ? 0.45 * adCount + 0.35 * longevity + 0.2 * strength : 0.8 * strength;

  // $1K/month → 0, $1M/month → 1 (log scale). Unknown counts low.
  const revenue = i.revenuePerMonth && i.revenuePerMonth > 0 ? clamp01((Math.log10(i.revenuePerMonth) - 3) / 3) : 0.2;

  const trend =
    i.growthPercent !== undefined
      ? clamp01((i.growthPercent + 30) / 110) // -30% → 0, +80% → 1
      : ({ Rising: 0.75, Stable: 0.5, Declining: 0.2 } as Record<string, number>)[i.trend ?? ""] ?? 0.45;

  const saturation = ({ Low: 1, Medium: 0.6, High: 0.2 } as Record<string, number>)[i.saturation ?? ""] ?? 0.5;

  const margin = i.marginPercent === undefined ? 0.5 : clamp01((i.marginPercent - 15) / 45); // 15% → 0, 60% → 1

  return { momentum: pct(momentum), revenue: pct(revenue), trend: pct(trend), saturation: pct(saturation), margin: pct(margin) };
}

/** Weighted sum of the parts, 0–1. */
export function rawScore(p: ScoreParts): number {
  const sum = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]).reduce((s, k) => s + SCORE_WEIGHTS[k] * p[k], 0);
  return Math.round(sum * 10) / 1000;
}

// ── Calibration ─────────────────────────────────────────────────────────────

export const HISTOGRAM_BINS = 1000;

export function binOf(raw: number): number {
  return Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(raw * HISTOGRAM_BINS)));
}

// Percentile → score: straight lines through these points.
const CURVE: [number, number][] = [
  [0, 1],
  [0.5, 45],
  [0.8, 70],
  [0.95, 85],
  [0.99, 92],
  [1, 99],
];

export function scoreFromPercentile(p: number): number {
  const x = clamp01(p);
  for (let i = 1; i < CURVE.length; i++) {
    const [x0, y0] = CURVE[i - 1];
    const [x1, y1] = CURVE[i];
    if (x <= x1) return Math.round(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  return 99;
}

/**
 * Percentile of a raw score in the catalog histogram. Products in the same bin
 * share the middle of that bin's range, so ties get one score.
 */
export function percentileOf(raw: number, histogram: number[]): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) return 0.5;
  const b = binOf(raw);
  let below = 0;
  for (let i = 0; i < b; i++) below += histogram[i];
  return (below + histogram[b] / 2) / total;
}

/** Share of scores at or above `min`, from a 0–100 score histogram (101 bins). */
export function shareAtLeast(scoreHistogram: number[], min: number): number {
  const total = scoreHistogram.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  return scoreHistogram.slice(min).reduce((a, b) => a + b, 0) / total;
}

export function medianOf(scoreHistogram: number[]): number {
  const total = scoreHistogram.reduce((a, b) => a + b, 0);
  let seen = 0;
  for (let s = 0; s < scoreHistogram.length; s++) {
    seen += scoreHistogram[s];
    if (seen >= total / 2) return s;
  }
  return 0;
}
