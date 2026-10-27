// Plan tiers and monthly usage shared by Istilam on Salla (sallaPlans.ts) and on Shopify (shopifyCod.ts).

export type Tier = "confirm" | "pro" | "bundle" | "trial";

/** Confirmations a month per tier; null = no limit. The trial gets the Pro allowance. */
export const TIER_LIMITS: Record<Tier, number | null> = { confirm: 500, pro: 3000, bundle: null, trial: 3000 };

/** Usage is counted per calendar month in Riyadh time: "2026-10". */
export function usageMonth(ms: number): string {
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
