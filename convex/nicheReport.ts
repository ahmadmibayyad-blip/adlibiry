"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claudeClient } from "./lib/claudeClient";

// ── AI niche report (Research → Niche Explorer) ─────────────────────────────
// Claude writes a short market analysis for one niche from the app's own
// numbers for it (products, winners, new ads, countries, top products).
// Signed-in users only; counts against the AI assistant's daily limit.

const ReportSchema = z.object({
  summary: z.string(),
  opportunities: z.array(z.string()),
  risks: z.array(z.string()),
  recommendedAudience: z.string(),
  competitionLevel: z.enum(["Low", "Medium", "High"]),
});

export const generate = action({
  args: { niche: v.string() },
  handler: async (ctx, args): Promise<z.infer<typeof ReportSchema>> => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    }
    const limit = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT ?? 30) || 30);
    const claim = await ctx.runMutation(internal.assistantUsage.claimMessage, { limit });
    if (!claim.signedIn) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to use AI reports." });
    if (!claim.allowed) throw new ConvexError({ code: "LIMIT", message: claim.message ?? "You've reached today's AI limit. Come back tomorrow." });

    const niches = await ctx.runQuery(internal.trends.listNichesInternal, {});
    const stats = niches.find((n) => n.name === args.niche);
    const top = await ctx.runQuery(internal.products.listInternal, {
      paginationOpts: { numItems: 8, cursor: null },
      categories: [args.niche],
      sort: "score",
    });
    const data = [
      stats
        ? `${stats.productCount} products tracked; average score of the top 20: ${stats.avgAiScore}/100; trend: ${stats.trendDirection}; ${stats.description}; top countries: ${stats.topCountries.join(", ") || "unknown"}.`
        : "No aggregate stats for this niche yet.",
      top.page.length
        ? `Top products by score:\n${top.page
            .map((p) => `- ${p.title} (score ${p.aiScore}${p.price !== undefined ? `, $${p.price}` : ""}${p.linkedAds ? `, ${p.linkedAds} ads` : ""})`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const client = claudeClient();
    try {
      const response = await client.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "low", format: zodOutputFormat(ReportSchema) },
        system:
          "You are a dropshipping market analyst. Write a concise, specific niche report for a store owner, grounded in the data given. Don't invent numbers that aren't in the data. Up to 4 opportunities and up to 4 risks, each one sentence. Competition level reflects ad saturation, entry barriers and how commoditised the niche is.",
        messages: [{ role: "user", content: `Niche: ${args.niche}\n\nData from AdSpy Pro:\n${data}` }],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        throw new ConvexError({ code: "AI_ERROR", message: "The AI couldn't write a report for this niche. Please try again." });
      }
      const r = response.parsed_output;
      return { ...r, opportunities: r.opportunities.slice(0, 4), risks: r.risks.slice(0, 4) };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error (niche report)", error.status, error.message);
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
