// Launch quota for Pro: LAUNCH_PRO_PRODUCTS (default 5) products in total, of
// which LAUNCH_PRO_STORES (default 3) can be full stores. Counted from the
// user's launches that didn't fail, once per product: launching a product
// again (new language, a fix, a replacement) is free, and a product launched as
// a page uses one store when it's first built as a full store.

export type QuotaLaunch = { productId: string; status: string; mode?: string };
export type LaunchAllowance = { left: number | null; limit: number | null; storesLeft: number | null; storesLimit: number | null };

const envCount = (value: string | undefined, fallback: number) => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export const proProductLimit = () => envCount(process.env.LAUNCH_PRO_PRODUCTS, 5);
export const proStoreLimit = () => envCount(process.env.LAUNCH_PRO_STORES, 3);

export const UNLIMITED: LaunchAllowance = { left: null, limit: null, storesLeft: null, storesLimit: null };

/** Products and full stores used so far. */
export function launchUsed(launches: QuotaLaunch[]): { products: Set<string>; stores: Set<string> } {
  const products = new Set<string>();
  const stores = new Set<string>();
  for (const l of launches) {
    if (l.status === "failed") continue;
    products.add(l.productId);
    if (l.mode === "store") stores.add(l.productId);
  }
  return { products, stores };
}

export function proAllowance(launches: QuotaLaunch[], limit = proProductLimit(), storesLimit = proStoreLimit()): LaunchAllowance {
  const used = launchUsed(launches);
  return {
    left: Math.max(0, limit - used.products.size),
    limit,
    storesLeft: Math.max(0, storesLimit - used.stores.size),
    storesLimit,
  };
}

/** Why this launch would go over the quota, or null when it fits. */
export function overQuota(launches: QuotaLaunch[], productId: string, mode: "page" | "store", allowance: LaunchAllowance): string | null {
  const used = launchUsed(launches);
  if (allowance.left !== null && !used.products.has(productId) && allowance.left <= 0) {
    return `You've launched ${allowance.limit} products, the most Pro includes. You can still launch those again.`;
  }
  if (mode === "store" && allowance.storesLeft !== null && !used.stores.has(productId) && allowance.storesLeft <= 0) {
    return `You've built ${allowance.storesLimit} full stores, the most Pro includes. Launch this one as a product page instead.`;
  }
  return null;
}
