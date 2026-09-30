"use node";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { listNichesTool, searchAdsTool, searchProductsTool } from "./lib/aiTools";

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

// The data tools live in lib/aiTools.ts (shared with the MCP server).
function makeTools(ctx: ActionCtx) {
  return [
    betaZodTool({ ...searchAdsTool, run: (input) => searchAdsTool.run(ctx, input) }),
    betaZodTool({ ...searchProductsTool, run: (input) => searchProductsTool.run(ctx, input) }),
    betaZodTool({ ...listNichesTool, run: () => listNichesTool.run(ctx) }),
  ];
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
    const ask = (withFallback: boolean) =>
      client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 16000,
        // Chat answers don't need deep reasoning; low effort keeps replies fast and cheap.
        output_config: { effort: "low" },
        // If a safety check declines a request, the API retries it on a suitable model.
        ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        system: SYSTEM,
        tools: makeTools(ctx),
        max_iterations: 6,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
    try {
      let final;
      try {
        final = await ask(true);
      } catch (e) {
        // The fallback option is a beta some accounts can't use: ask again without it.
        if (!(e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message))) throw e;
        console.warn("Claude: retrying without server-side fallback:", e.message);
        final = await ask(false);
      }
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
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error", error.status, error.message);
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
