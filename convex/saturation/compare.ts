"use node";

// Country comparison for the Country Saturation Analyzer — scores several
// countries side by side for the same niche in one pass, reusing the exact
// same pure scoring math as the single-country check. No AI narrative and no
// persisted history here; this is a fast, real-data-only comparison view.

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { demandLabel, opportunityLabel, saturationLabel, scoreCountry } from "../lib/saturationScoring";

export type CountryComparisonRow = {
  country: string;
  saturationScore: number;
  saturationLabel: string;
  demandScore: number;
  demandLabel: string;
  opportunityScore: number;
  opportunityLabel: string;
  confidenceScore: number;
  localAdvertiserCount: number;
  localStoreCount: number;
};

export const compareCountries = action({
  args: {
    niche: v.string(),
    countries: v.array(v.string()), // ISO country codes
  },
  handler: async (ctx, args): Promise<CountryComparisonRow[]> => {
    const now = Date.now();

    const [adsResult, storesResult, trends, suppliers] = await Promise.all([
      ctx.runQuery(internal.ads.listInternal, {
        paginationOpts: { numItems: 200, cursor: null },
        niche: args.niche,
      }),
      ctx.runQuery(internal.stores.listInternal, {
        paginationOpts: { numItems: 200, cursor: null },
        niche: args.niche,
      }),
      ctx.runQuery(internal.trends.listInternal, { niche: args.niche }),
      ctx.runQuery(internal.trends.searchSuppliersInternal, {
        paginationOpts: { numItems: 50, cursor: null },
        niche: args.niche,
      }),
    ]);

    const allAds = adsResult.page;
    const globalAdvertiserCount = new Set(allAds.map((a) => a.advertiserName)).size;
    const allStores = storesResult.page;
    const trend = trends[0];

    const supplierSellerCounts = suppliers.page.map((s) => s.sellerCount);
    const avgSupplierSellers =
      supplierSellerCounts.length > 0
        ? Math.round(supplierSellerCounts.reduce((a, b) => a + b, 0) / supplierSellerCounts.length)
        : undefined;

    return args.countries.map((country) => {
      const localAds = allAds.filter((a) => a.country === country);
      const localStores = allStores.filter((s) => s.country === country);
      const trendCountryInterest = trend?.countryBreakdown.find((c) => c.country === country)?.interest;

      const { saturationScore, demandScore, opportunityScore, confidenceScore, signals } = scoreCountry({
        localAds,
        globalAdvertiserCount,
        localStores,
        trendCountryInterest,
        trendDirection: trend?.direction,
        trendRisingPercent: trend?.risingPercent,
        avgSupplierSellers,
        hasTrendData: trend !== undefined,
        hasSupplierData: avgSupplierSellers !== undefined,
        now,
      });

      return {
        country,
        saturationScore,
        saturationLabel: saturationLabel(saturationScore),
        demandScore,
        demandLabel: demandLabel(demandScore),
        opportunityScore,
        opportunityLabel: opportunityLabel(opportunityScore),
        confidenceScore,
        localAdvertiserCount: signals.localAdvertiserCount,
        localStoreCount: signals.localStoreCount,
      };
    });
  },
});
