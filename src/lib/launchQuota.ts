// Launch quota as the app shows it (convex/lib/launchQuota.ts counts it).
type Allowance = { left: number | null; limit: number | null; storesLeft?: number | null; storesLimit?: number | null };

/** "3 of 5 products · 2 of 3 stores left", or "Unlimited launches". */
export function launchQuotaLabel(a: Allowance): string {
  if (a.left === null) return "Unlimited launches";
  const stores = a.storesLeft != null && a.storesLimit != null ? ` · ${a.storesLeft} of ${a.storesLimit} stores` : "";
  return `${a.left} of ${a.limit} products${stores} left`;
}

export const LAUNCH_TRIAL_NOTE = "Launch opens when you subscribe to Pro: 5 products, 3 of them as full stores. The free trial covers the research tools.";
export const LAUNCH_PRO_NOTE = "Launch is part of Pro: 5 products, 3 of them as full Shopify stores.";
