"use node";

// Country Saturation Analyzer — computes Saturation, Demand, and Opportunity
// scores from AdSpy Pro's own real tracked data (Ad Spy, Store Tracker, Trends,
// Suppliers), filtered by country. Never fabricates competitor counts: every
// number in the response traces back to a real row in our database. The AI
// step only writes a narrative explanation of numbers we hand it — it cannot
// invent statistics.

import { v } from "convex/values";
import { claudeClient } from "../lib/claudeClient";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { claimAiRequest } from "../lib/aiQuota";
import { adInCountry, demandLabel, opportunityLabel, saturationLabel, scoreCountry } from "../lib/saturationScoring";


export type SaturationSignals = {
  localAdvertiserCount: number;
  localActiveAds: number;
  recentLocalAdvertisers30d: number;
  globalAdvertiserCount: number;
  localStoreCount: number;
  localStoreActiveAds: number;
  supplierSellerCount?: number;
  trendInterest?: number;
  trendDirection?: string;
  trendRisingPercent?: number;
  sourcesAnalyzed: string[];
  sourcesUnavailable: string[];
};

export type SaturationResult = {
  saturationScore: number;
  saturationLabel: string;
  demandScore: number;
  demandLabel: string;
  opportunityScore: number;
  opportunityLabel: string;
  confidenceScore: number;
  signals: SaturationSignals;
  aiSummary: string;
};

export const analyzeSaturation = action({
  args: {
    productTitle: v.string(),
    niche: v.string(),
    country: v.string(), // ISO country code
  },
  handler: async (ctx, args): Promise<SaturationResult> => {
    await claimAiRequest(ctx);
    const now = Date.now();

    // ── Our own tracked ads only: distinct advertisers in this country ──
    const allAds = await ctx.runQuery(internal.saturation.mutations.nicheAds, { niche: args.niche });
    const localAds = allAds.filter((a) => adInCountry(a, args.country));
    const globalAdvertisers = new Set(allAds.map((a) => a.advertiserName));

    const { saturationScore, demandScore, opportunityScore, confidenceScore, signals } = scoreCountry({
      localAds,
      globalAdvertiserCount: globalAdvertisers.size,
      localStores: [],
      hasTrendData: false,
      hasSupplierData: false,
      now,
      adsOnly: true,
    });
    const sourcesAnalyzed = signals.sourcesAnalyzed;
    const sourcesUnavailable = signals.sourcesUnavailable;

    // ── AI narrative — strictly grounded in the numbers above, never invented ──
    let aiSummary: string;
    try {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set");
      const response = await claudeClient().messages.create({
        model: "claude-opus-5-5",
        max_tokens: 1500,
        output_config: { effort: "low" },
        system:
          "You are a dropshipping market analyst. You are given REAL, already-computed data points about a product's competition and demand in a specific country, sourced only from our own ad-tracking database. Write a short (3-4 sentence) analysis referencing ONLY the numbers given. Never invent competitor names, counts, or statistics that were not provided. If few ads back the check, say that it lowers confidence. Reply with the analysis only.",
        messages: [
          {
            role: "user",
            content: `Product: ${args.productTitle}\nNiche: ${args.niche}\nCountry: ${args.country}\n\nTracked local advertisers (Meta/TikTok): ${signals.localAdvertiserCount}\nTracked local ads: ${signals.localActiveAds}\nAdvertisers active in the last 30 days: ${signals.recentLocalAdvertisers30d}\nAdvertisers tracked in this niche (all countries): ${signals.globalAdvertiserCount}\n\nComputed Saturation Score: ${saturationScore}/100\nComputed Demand Score: ${demandScore}/100\nComputed Opportunity Score: ${opportunityScore}/100\nData sources analyzed: ${sourcesAnalyzed.join(", ")}\nData sources unavailable: ${sourcesUnavailable.join(", ") || "none"}`,
          },
        ],
      });
      aiSummary = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
    } catch {
      aiSummary = "";
    }
    if (!aiSummary) {
      aiSummary = `Based on ${signals.localAdvertiserCount} tracked local advertiser(s) in our ad database, this market shows ${saturationLabel(saturationScore).toLowerCase()}.`;
    }

    // Persist a real snapshot so a saturation trend can build up over time.
    await ctx.runMutation(internal.saturation.mutations.recordCheck, {
      productTitle: args.productTitle,
      niche: args.niche,
      country: args.country,
      saturationScore,
      demandScore,
      opportunityScore,
      confidenceScore,
      signals,
      aiSummary,
    });

    return {
      saturationScore,
      saturationLabel: saturationLabel(saturationScore),
      demandScore,
      demandLabel: demandLabel(demandScore),
      opportunityScore,
      opportunityLabel: opportunityLabel(opportunityScore),
      confidenceScore,
      signals,
      aiSummary,
    };
  },
});
