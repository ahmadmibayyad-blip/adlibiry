"use node";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";

// ── AI assistant (Claude) ────────────────────────────────────────────────────
// A chat assistant for signed-in customers. Claude answers from the app's own
// ads and products through read-only tools that call the same queries the
// pages use. Set ANTHROPIC_API_KEY in Convex. ASSISTANT_DAILY_LIMIT (default
// 30) caps messages per user per day; admins are not capped.

const MODEL = "claude-opus-5-5";
const MAX_HISTORY = 20;
const MAX_CHARS = 4000;

const SYSTEM = `You are the AI assistant inside AdSpy Pro, a product-research and ad-spy tool for dropshippers and e-commerce sellers.

You help customers find winning products and ads, understand why an ad works, write hooks and ad copy, and plan tests. Use the tools to look at the app's real data before recommending specific products or ads. Only state numbers (likes, views, spend, days running, prices, scores) that a tool returned; spend and revenue figures are estimates, so call them estimates. If the data doesn't cover a question, say so.

Pages customers can open:
- Winning products: /dashboard/products (one product: /dashboard/products/<id>)
- Ad Spy (all ads, with filters): /dashboard/ad-spy
- Niche research: /dashboard/research
- Store tracker: /dashboard/stores

When you mention a product from a tool result, link it as /dashboard/products/<id>. Ads have no page of their own; point to Ad Spy and name the advertiser and headline so the customer can find it.

Keep answers short and practical: lead with the answer, use short lists, no long preambles. Reply in the customer's language.`;

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

function makeTools(ctx: ActionCtx) {
  const searchAds = betaZodTool({
    name: "search_ads",
    description:
      "Search the ad library (Facebook, Instagram, TikTok ads). Returns up to `limit` ads with advertiser, headline, text, niche, likes, views, days running, estimated spend, score and landing page. Use `search` for words in the ad text; leave it empty to browse by niche/platform and sort.",
    inputSchema: z.object({
      search: z.string().optional().describe("Words that appear in the ad text, e.g. 'posture corrector'"),
      niche: z.string().optional().describe("Exact niche name from list_niches, e.g. 'Beauty'"),
      platform: z.enum(["Facebook", "Instagram", "TikTok"]).optional(),
      country: z.string().optional().describe("ISO country code, e.g. 'US', 'DK'"),
      mediaType: z.enum(["video", "image", "carousel"]).optional(),
      minDaysRunning: z.number().optional().describe("Only ads running at least this many days (a sign they are profitable)"),
      sort: z.enum(["newest", "score", "mostLiked", "longestRunning", "impressions", "comments"]).optional(),
      limit: z.number().min(1).max(15).optional().describe("How many ads to return (default 8)"),
    }),
    run: async ({ limit, search, ...filters }) => {
      const result = await ctx.runQuery(api.ads.list, {
        paginationOpts: { numItems: limit ?? 8, cursor: null },
        ...filters,
        ...(search?.trim() ? { search: search.trim() } : {}),
      });
      return JSON.stringify(
        result.page.map((a) => ({
          advertiser: a.advertiserName,
          platform: a.platform,
          country: a.country,
          niche: a.niche,
          headline: clip(a.headline, 160),
          text: clip(a.bodyText, 400),
          mediaType: a.mediaType,
          likes: a.likes,
          views: a.views,
          comments: a.comments,
          daysRunning: a.daysRunning,
          spendEstimate: a.spendEstimate,
          score: a.aiScore,
          cta: a.ctaText,
          landingPage: a.landingPageUrl || undefined,
        })),
      );
    },
  });

  const searchProducts = betaZodTool({
    name: "search_products",
    description:
      "Search the winning-products database. Returns up to `limit` products with id, title, category, price, cost, margin, score, trend, saturation, ads running and likes. Use `search` for words in the product title.",
    inputSchema: z.object({
      search: z.string().optional().describe("Words in the product title, e.g. 'dog bed'"),
      category: z.string().optional().describe("Exact niche/category name from list_niches"),
      maxPrice: z.number().optional().describe("Max selling price in USD"),
      minMargin: z.number().min(0).max(100).optional().describe("Minimum margin in percent"),
      trend: z.enum(["Rising", "Stable", "Declining"]).optional(),
      winnerOfDayOnly: z.boolean().optional().describe("Only today's picked winners"),
      sort: z.enum(["newest", "score", "ads", "likes", "growth", "margin"]).optional(),
      limit: z.number().min(1).max(15).optional().describe("How many products to return (default 8)"),
    }),
    run: async ({ limit, search, ...filters }) => {
      const result = await ctx.runQuery(api.products.list, {
        paginationOpts: { numItems: limit ?? 8, cursor: null },
        ...filters,
        ...(search?.trim() ? { search: search.trim() } : {}),
      });
      return JSON.stringify(
        result.page.map((p) => ({
          id: p._id,
          title: clip(p.title, 160),
          category: p.category,
          price: p.price,
          cost: p.cost,
          marginPercent: p.price && p.cost !== undefined ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined,
          priceIsEstimate: p.priceSource === "estimated_market" || undefined,
          score: p.aiScore,
          trend: p.trend,
          saturation: p.saturation,
          adsRunning: p.adsCount,
          likes: p.likes,
          growthPercent: p.growthPercent,
          winnerOfDay: p.isWinnerOfDay || undefined,
        })),
      );
    },
  });

  const listNiches = betaZodTool({
    name: "list_niches",
    description: "List the niche names used for ads and products, to pass as `niche` or `category` in the other tools.",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await ctx.runQuery(api.ads.getNiches, {})),
  });

  return [searchAds, searchProducts, listNiches];
}

export const chat = action({
  args: {
    messages: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
  },
  handler: async (ctx, args): Promise<{ reply: string; used: number; limit: number }> => {
    const history = args.messages.slice(-MAX_HISTORY).filter((m) => m.content.trim());
    const last = history[history.length - 1];
    if (!last || last.role !== "user") throw new ConvexError({ code: "BAD_REQUEST", message: "Send a message first." });
    if (history.some((m) => m.content.length > MAX_CHARS)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: `Messages can be at most ${MAX_CHARS} characters.` });
    }
    // The API needs the conversation to start with the customer.
    while (history.length && history[0].role !== "user") history.shift();

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ConvexError({ code: "NOT_CONFIGURED", message: "The AI assistant isn't set up yet (missing ANTHROPIC_API_KEY)." });
    }
    const limit = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT ?? 30) || 30);
    const claim = await ctx.runMutation(internal.assistantUsage.claimMessage, { limit });
    if (!claim.signedIn) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to use the AI assistant." });
    if (!claim.allowed) {
      throw new ConvexError({ code: "LIMIT", message: `You've used all ${limit} AI messages for today. Come back tomorrow.` });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const final = await client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 16000,
        // Chat answers don't need deep reasoning; low effort keeps replies fast and cheap.
        output_config: { effort: "low" },
        // If a safety check declines a request, the API retries it on a suitable model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        tools: makeTools(ctx),
        max_iterations: 6,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      if (final.stop_reason === "refusal") {
        return { reply: "Sorry, I can't help with that one. Try asking about products, ads or niches.", used: claim.used, limit };
      }
      const reply = final.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        reply: reply || "I couldn't put an answer together. Try rephrasing your question.",
        used: claim.used,
        limit,
      };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ConvexError({ code: "NOT_CONFIGURED", message: "The AI assistant's API key is invalid." });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ConvexError({ code: "BUSY", message: "The AI assistant is busy right now. Try again in a minute." });
      }
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error", error.status, error.message);
        throw new ConvexError({ code: "AI_ERROR", message: "The AI assistant had a problem. Please try again." });
      }
      throw error;
    }
  },
});
