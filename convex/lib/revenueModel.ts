// Revenue model: triangulating a store's monthly revenue from independent
// signals, and calibrating every estimation method against a known-truth set
// (convex/revenueTruth.ts). Pure, unit tested.

import type { Confidence } from "./estimates";

// Share of buyers who leave a review on a Shopify product page.
export const REVIEW_RATE = 0.02;
const WEEKS_PER_MONTH = 4.33;

export type StoreSignals = {
  catalogDailyRevenue?: number; // USD/day from catalog changes (1–3 orders per changed product, middle)
  reviewsPerWeek?: number; // reviews gained per week on its best sellers
  avgPrice?: number; // USD
};

/**
 * One monthly figure from whichever signals exist: the geometric mean of
 * catalog-change revenue and review-velocity revenue. High confidence when
 * both exist and agree within 2×, Medium when only one exists or they
 * disagree, undefined with none.
 */
export function storeRevenueEstimate(s: StoreSignals): { point: number; confidence: Confidence; basis: string[] } | undefined {
  const estimates: { basis: string; value: number }[] = [];
  if (s.catalogDailyRevenue && s.catalogDailyRevenue > 0) estimates.push({ basis: "catalog_changes", value: s.catalogDailyRevenue * 30 });
  if (s.reviewsPerWeek && s.reviewsPerWeek > 0 && s.avgPrice && s.avgPrice > 0) {
    estimates.push({ basis: "review_velocity", value: (s.reviewsPerWeek / REVIEW_RATE) * WEEKS_PER_MONTH * s.avgPrice });
  }
  if (!estimates.length) return undefined;
  const point = Math.round(Math.exp(estimates.reduce((a, e) => a + Math.log(e.value), 0) / estimates.length));
  const agree = estimates.length >= 2 && Math.max(...estimates.map((e) => e.value)) / Math.min(...estimates.map((e) => e.value)) <= 2;
  return { point, confidence: agree ? "High" : "Medium", basis: estimates.map((e) => e.basis) };
}

// ── Calibration ─────────────────────────────────────────────────────────────

export type CalibrationRow = { basis: string; truth: number; estimate: number };
export type BasisCalibration = { n: number; factor: number; medianErrorPct: number };

export const MIN_CALIBRATION_ROWS = 5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

/**
 * Per estimation method: how many known-truth examples, the median of
 * truth ÷ estimate (the factor estimates get multiplied by once there are
 * MIN_CALIBRATION_ROWS), and the median error before correcting.
 */
export function calibrate(rows: CalibrationRow[]): Record<string, BasisCalibration> {
  const byBasis = new Map<string, CalibrationRow[]>();
  for (const r of rows) {
    if (!(r.truth > 0) || !(r.estimate > 0)) continue;
    byBasis.set(r.basis, [...(byBasis.get(r.basis) ?? []), r]);
  }
  const out: Record<string, BasisCalibration> = {};
  for (const [basis, list] of byBasis) {
    const factor = median(list.map((r) => r.truth / r.estimate));
    const medianErrorPct = Math.round(median(list.map((r) => Math.abs(r.estimate - r.truth) / r.truth)) * 100);
    out[basis] = { n: list.length, factor: Math.round(factor * 1000) / 1000, medianErrorPct };
  }
  return out;
}

/** The factor to apply for a method: 1 until it has enough known-truth examples. */
export function factorFor(cal: Record<string, BasisCalibration> | undefined, basis: string | undefined): number {
  const c = basis ? cal?.[basis] : undefined;
  return c && c.n >= MIN_CALIBRATION_ROWS && c.factor > 0 ? c.factor : 1;
}
