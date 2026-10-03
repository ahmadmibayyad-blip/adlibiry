"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import * as z from "zod";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { claimAiRequest } from "./lib/aiQuota";

const openai = new OpenAI({
  // Your own OpenAI (or any OpenAI-compatible) key. Set OPENAI_API_KEY in Convex.
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "missing-openai-key",
});

function handleAiError(error: unknown): never {
  if (error instanceof OpenAI.APIError) {
    throw new Error(`AI Gateway Error: ${error.message}`);
  }
  throw new Error("AI request failed. Please try again.");
}

// ── AI Product Score ─────────────────────────────────────────────────────────

const ProductScoreSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string(),
  strengths: z.array(z.string()).max(4),
  risks: z.array(z.string()).max(4),
});

export const scoreProduct = action({
  args: {
    title: v.string(),
    description: v.string(),
    price: v.number(),
    cost: v.number(),
    category: v.string(),
  },
  handler: async (ctx, args): Promise<z.infer<typeof ProductScoreSchema>> => {
    await claimAiRequest(ctx);
    const margin = Math.round(((args.price - args.cost) / args.price) * 100);
    try {
      const response = await openai.chat.completions.parse({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "You are a blunt, experienced dropshipping analyst. Rate products on winning potential for paid social ads (Facebook/TikTok). Be honest and specific — never inflate scores. Consider: 'wow factor' for video ads, problem-solution clarity, price point vs perceived value, margin health, market saturation risk, and shipping/return friction. A score of 90+ should be rare and reserved for genuinely exceptional products.",
          },
          {
            role: "user",
            content: `Product: ${args.title}\nCategory: ${args.category}\nDescription: ${args.description}\nSell price: $${args.price}\nSupplier cost: $${args.cost}\nMargin: ${margin}%\n\nRate this product's winning potential 0-100 and explain your reasoning.`,
          },
        ],
        response_format: zodResponseFormat(ProductScoreSchema, "score"),
      });

      const parsed = response.choices[0]?.message?.parsed;
      if (!parsed) throw new Error("AI returned an empty response");
      return parsed;
    } catch (error) {
      handleAiError(error);
    }
  },
});

// ── AI Ad Angle Generator ───────────────────────────────────────────────────

const AdAnglesSchema = z.object({
  angles: z
    .array(
      z.object({
        hook: z.string(),
        angle: z.string(),
        description: z.string(),
      })
    )
    .length(5),
});

export const generateAdAngles = action({
  args: {
    title: v.string(),
    description: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args): Promise<z.infer<typeof AdAnglesSchema>> => {
    await claimAiRequest(ctx);
    try {
      const response = await openai.chat.completions.parse({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "You are a senior direct-response copywriter for dropshipping Facebook/TikTok ads. Generate 5 distinct ad angles for the given product, each with a punchy scroll-stopping hook (under 12 words), a one-word/short-phrase angle name (e.g. 'Pain point', 'Social proof', 'Curiosity', 'Before/after', 'Urgency'), and a 1-2 sentence description of the creative approach.",
          },
          {
            role: "user",
            content: `Product: ${args.title}\nCategory: ${args.category}\nDescription: ${args.description}\n\nGenerate 5 ad angles.`,
          },
        ],
        response_format: zodResponseFormat(AdAnglesSchema, "angles"),
      });

      const parsed = response.choices[0]?.message?.parsed;
      if (!parsed) throw new Error("AI returned an empty response");
      return parsed;
    } catch (error) {
      handleAiError(error);
    }
  },
});

// ── AI Competitor Finder ────────────────────────────────────────────────────
// Honest by design: searches our own tracked ads + stores data for real matches
// by niche/keyword overlap, then asks AI to rank and explain the matches.
// Never fabricates competitors that aren't backed by real tracked data.

const CompetitorAnalysisSchema = z.object({
  summary: z.string(),
  rankedMatches: z.array(
    z.object({
      name: z.string(),
      whyRelevant: z.string(),
    })
  ),
});

type AdMatch = { advertiserName: string; platform: string; niche: string; headline: string };
type StoreMatch = { name: string; niche: string; url: string };

export const findCompetitors = action({
  args: {
    productTitle: v.string(),
    category: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    summary: string;
    rankedMatches: Array<{ name: string; whyRelevant: string }>;
    matchedAds: AdMatch[];
    matchedStores: StoreMatch[];
  }> => {
    await claimAiRequest(ctx);
    // Pull real tracked data from our own database — never invent competitors.
    const [adsResult, storesResult] = await Promise.all([
      ctx.runQuery(api.ads.list, {
        paginationOpts: { numItems: 50, cursor: null },
        niche: args.category,
      }),
      ctx.runQuery(api.stores.list, {
        paginationOpts: { numItems: 50, cursor: null },
        niche: args.category,
      }),
    ]);

    const matchedAds: AdMatch[] = adsResult.page.map((a) => ({
      advertiserName: a.advertiserName,
      platform: a.platform,
      niche: a.niche,
      headline: a.headline,
    }));
    const matchedStores: StoreMatch[] = storesResult.page.map((s) => ({
      name: s.name,
      niche: s.niche,
      url: s.url,
    }));

    if (matchedAds.length === 0 && matchedStores.length === 0) {
      return {
        summary: `No tracked ads or stores currently match the "${args.category}" category. Check back as more data is added to Ad Spy and Store Tracker, or broaden your search.`,
        rankedMatches: [],
        matchedAds: [],
        matchedStores: [],
      };
    }

    try {
      const response = await openai.chat.completions.parse({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "You are a competitive intelligence analyst. You are given a product and a list of REAL advertisers and stores we have already tracked in the same category. Rank which ones are most likely selling a similar or competing product, and briefly explain why, based only on the names/headlines provided. Do not invent any competitors not in the provided list.",
          },
          {
            role: "user",
            content: `Product we're researching: ${args.productTitle} (category: ${args.category})\n\nTracked advertisers in this category:\n${matchedAds.map((a) => `- ${a.advertiserName} (${a.platform}): "${a.headline}"`).join("\n") || "None"}\n\nTracked stores in this category:\n${matchedStores.map((s) => `- ${s.name} (${s.url})`).join("\n") || "None"}\n\nWrite a short summary, then rank the most relevant matches with a brief reason each.`,
          },
        ],
        response_format: zodResponseFormat(CompetitorAnalysisSchema, "analysis"),
      });

      const parsed = response.choices[0]?.message?.parsed;
      if (!parsed) throw new Error("AI returned an empty response");
      return { ...parsed, matchedAds, matchedStores };
    } catch (error) {
      handleAiError(error);
    }
  },
});
