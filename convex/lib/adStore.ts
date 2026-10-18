// The store behind an ad, for the ad page and pop-up (stores.forAd): what we
// track about it (revenue, traffic, live ads, best sellers) and the newest
// Store Inspector result for its address (theme, apps, the product page's
// price and reviews), cut down to what the panel shows. Pure, unit tested.
import type { Inspection } from "./storeInspect";

export const AD_STORE_APPS = 8;
export const AD_STORE_BEST_SELLERS = 3;

export type AdStoreInspection = {
  inspectedAt: string;
  shopify: boolean;
  theme?: string; // "Dawn", or the owner's name for the copy when the base theme isn't known
  apps: { name: string; category: string }[];
  appCount: number;
  reviews?: { rating?: number; count?: number; app?: string };
  price?: { price: number; compareAt?: number; percentOff?: number; currency?: string };
  bundleTiers?: number;
  productTitle?: string;
  onlineSince?: string; // ISO date: domain registered, else first Wayback Machine copy
};

export function inspectionSummary(result: Inspection | undefined, inspectedAt: string): AdStoreInspection | null {
  if (!result || typeof result !== "object") return null;
  const t = result.teardown ?? undefined;
  const apps = Array.isArray(result.apps) ? result.apps : [];
  return {
    inspectedAt,
    shopify: !!result.shopify,
    ...(result.theme ? { theme: result.theme.schemaName || result.theme.name } : {}),
    apps: apps.slice(0, AD_STORE_APPS).map((a) => ({ name: a.name, category: a.category })),
    appCount: apps.length,
    ...(t?.reviews && (t.reviews.rating || t.reviews.count)
      ? { reviews: { rating: t.reviews.rating, count: t.reviews.count, app: t.reviews.app } }
      : {}),
    ...(t?.price ? { price: { price: t.price.price, compareAt: t.price.compareAt, percentOff: t.price.percentOff, currency: t.price.currency } } : {}),
    ...(t?.bundle?.tiers.length ? { bundleTiers: t.bundle.tiers.length } : {}),
    ...(t?.productTitle ? { productTitle: t.productTitle } : {}),
    ...(result.domain?.registered || result.history?.firstSeen ? { onlineSince: result.domain?.registered ?? result.history?.firstSeen } : {}),
  };
}
