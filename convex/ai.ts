"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ConvexError, v } from "convex/values";
import * as z from "zod";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { claimAiRequest } from "./lib/aiQuota";
import { isDemoAd, isDemoStore, productFacts } from "./lib/aiFacts";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";

// ── AI tools on the product page (Claude) ───────────────────────────────────
// AI second opinion, ad angles and competitor finder. Like the assistant and
// agents they use Claude through claudeClient() (ANTHROPIC_API_KEY), with a
// structured answer, and every failure reaches the user as a readable
// ConvexError (plain errors show only "Server Error" in production).

const MODEL = "claude-opus-5-5";

async function askClaude<S extends z.ZodType>(ctx: ActionCtx, schema: S, system: string, user: string): Promise<z.infer<S>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ConvexError({ code: "NOT_CONFIGURED", message: "The AI tools aren't set up yet (missing ANTHROPIC_API_KEY)." });
  }
  try {
    const message = await claudeClient().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
      // Short, focused answers: low effort keeps them fast and cheap.
      output_config: { effort: "low", format: zodOutputFormat(schema) },
    });
    if (message.stop_reason === "refusal") throw new ConvexError({ code: "REFUSED", message: "The AI declined this one. Try another product." });
    if (!message.parsed_output) throw new ConvexError({ code: "EMPTY", message: "The AI didn't return an answer. Please try again." });
    return message.parsed_output as z.infer<S>;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    if (error instanceof Anthropic.APIError) {
      console.error("Claude API error", error.status, error.message);
      const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
      throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, !!isAdmin) });
    }
    console.error("AI tool failed", error);
    throw new ConvexError({ code: "AI_ERROR", message: "The AI had a problem. Please try again." });
  }
}

// ── AI second opinion ───────────────────────────────────────────────────────

const ProductScoreSchema = z.object({
  score: z.number(),
  verdict: z.string(),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
});

export const scoreProduct = action({
  args: {
    title: v.string(),
    description: v.string(),
    // Missing when we don't know them: the AI is told "unknown", never $0.
    price: v.optional(v.number()),
    cost: v.optional(v.number()),
    category: v.string(),
  },
  handler: async (ctx, args): Promise<z.infer<typeof ProductScoreSchema>> => {
    await claimAiRequest(ctx);
    const r = await askClaude(
      ctx,
      ProductScoreSchema,
      "You are a blunt, experienced dropshipping analyst. Rate products on winning potential for paid social ads (Facebook/TikTok) from 0 to 100. Be honest and specific — never inflate scores. Consider: 'wow factor' for video ads, problem-solution clarity, price point vs perceived value, margin health, market saturation risk, and shipping/return friction. A score of 90+ should be rare and reserved for genuinely exceptional products. If the price, cost or margin is unknown, say so instead of assuming one. Give up to 4 strengths and up to 4 risks.",
      `${productFacts(args)}\n\nRate this product's winning potential 0-100 and explain your reasoning.`,
    );
    return { ...r, score: Math.max(0, Math.min(100, Math.round(r.score))), strengths: r.strengths.slice(0, 4), risks: r.risks.slice(0, 4) };
  },
});

// ── AI Ad Angle Generator ───────────────────────────────────────────────────

const AdAnglesSchema = z.object({
  angles: z.array(z.object({ hook: z.string(), angle: z.string(), description: z.string() })),
});

export const generateAdAngles = action({
  args: {
    title: v.string(),
    description: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args): Promise<z.infer<typeof AdAnglesSchema>> => {
    await claimAiRequest(ctx);
    const r = await askClaude(
      ctx,
      AdAnglesSchema,
      "You are a senior direct-response copywriter for dropshipping Facebook/TikTok ads. Generate exactly 5 distinct ad angles for the given product, each with a punchy scroll-stopping hook (under 12 words), a one-word/short-phrase angle name (e.g. 'Pain point', 'Social proof', 'Curiosity', 'Before/after', 'Urgency'), and a 1-2 sentence description of the creative approach.",
      `Product: ${args.title}\nCategory: ${args.category}\nDescription: ${args.description}\n\nGenerate 5 ad angles.`,
    );
    return { angles: r.angles.slice(0, 5) };
  },
});

// ── AI Competitor Finder ────────────────────────────────────────────────────
// Honest by design: searches our own tracked ads + stores data for real matches
// by niche, then asks AI to rank and explain the matches. Never fabricates
// competitors that aren't backed by real tracked data.

const CompetitorAnalysisSchema = z.object({
  summary: z.string(),
  rankedMatches: z.array(z.object({ name: z.string(), whyRelevant: z.string() })),
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
    args,
  ): Promise<{
    summary: string;
    rankedMatches: Array<{ name: string; whyRelevant: string }>;
    matchedAds: AdMatch[];
    matchedStores: StoreMatch[];
  }> => {
    await claimAiRequest(ctx);
    // Pull real tracked data from our own database — never invent competitors.
    const [adsResult, storesResult] = await Promise.all([
      ctx.runQuery(internal.ads.listInternal, { paginationOpts: { numItems: 50, cursor: null }, niche: args.category }),
      ctx.runQuery(internal.stores.listInternal, { paginationOpts: { numItems: 50, cursor: null }, niche: args.category }),
    ]);

    // Demo rows from the admin seed functions aren't real competitors.
    const matchedAds: AdMatch[] = adsResult.page.filter((a) => !isDemoAd(a)).map((a) => ({
      advertiserName: a.advertiserName,
      platform: a.platform,
      niche: a.niche,
      headline: a.headline,
    }));
    const matchedStores: StoreMatch[] = storesResult.page.filter((s) => !isDemoStore(s)).map((s) => ({
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

    const r = await askClaude(
      ctx,
      CompetitorAnalysisSchema,
      "You are a competitive intelligence analyst. You are given a product and a list of REAL advertisers and stores we have already tracked in the same category. Rank which ones are most likely selling a similar or competing product, and briefly explain why, based only on the names/headlines provided. Do not invent any competitors not in the provided list.",
      `Product we're researching: ${args.productTitle} (category: ${args.category})\n\nTracked advertisers in this category:\n${matchedAds.map((a) => `- ${a.advertiserName} (${a.platform}): "${a.headline}"`).join("\n") || "None"}\n\nTracked stores in this category:\n${matchedStores.map((s) => `- ${s.name} (${s.url})`).join("\n") || "None"}\n\nWrite a short summary, then rank the most relevant matches with a brief reason each.`,
    );
    // Only names that are really in our lists.
    const known = new Set([...matchedAds.map((a) => a.advertiserName), ...matchedStores.map((s) => s.name)].map((n) => n.toLowerCase()));
    return { ...r, rankedMatches: r.rankedMatches.filter((m) => known.has(m.name.toLowerCase())), matchedAds, matchedStores };
  },
});
