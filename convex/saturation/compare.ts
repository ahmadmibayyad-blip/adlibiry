"use node";

// Country comparison for the Country Saturation Analyzer — scores several
// countries side by side for the same niche in one pass, reusing the exact
// same pure scoring math as the single-country check. No AI narrative and no
// persisted history here; this is a fast, real-data-only comparison view.

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireSignedIn } from "../lib/access";
import { adInCountry, demandLabel, opportunityLabel, saturationLabel, scoreCountry } from "../lib/saturationScoring";

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
    await requireSignedIn(ctx);
    const now = Date.now();

    // Our own tracked ads only (distinct advertisers per country).
    const allAds = await ctx.runQuery(internal.saturation.mutations.nicheAds, { niche: args.niche });
    const globalAdvertiserCount = new Set(allAds.map((a) => a.advertiserName)).size;

    return args.countries.map((country) => {
      const localAds = allAds.filter((a) => adInCountry(a, country));

      const { saturationScore, demandScore, opportunityScore, confidenceScore, signals } = scoreCountry({
        localAds,
        globalAdvertiserCount,
        localStores: [],
        hasTrendData: false,
        hasSupplierData: false,
        now,
        adsOnly: true,
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
