"use node";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claudeClient } from "./lib/claudeClient";
import { listNichesTool, searchAdsTool, searchProductsTool } from "./lib/aiTools";

// Runs AI agents (see convex/agents.ts): Claude looks through the app's data
// with the same read-only tools as the assistant and writes a briefing.
// Daily for every enabled agent (crons.ts); AGENT_DAILY_MAX (default 200)
// caps how many run per day so the Claude bill stays bounded.

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are a product-research agent inside AdSpy Pro, an ad-spy and winning-product tool for dropshippers. Each morning you work on one customer's standing goal using the app's data tools, then write a short briefing.

Rules:
- Look at the real data with the tools before recommending anything. Only state numbers a tool returned; call spend and revenue figures estimates.
- Prefer things that are new or changed since the previous briefing (it is given below when there is one); don't repeat the same picks unless something changed.
- Link each product you mention as /dashboard/products/<id>. Ads have no link; name the advertiser and headline.
- If nothing matches the goal today, say so in one line and suggest a tweak to the goal.

Format (plain text with short lines, no tables):
**Today's picks** — 3 to 5 items, one line each: name, link, the numbers that matter, why it fits the goal.
**Ads to watch** — up to 3, one line each (optional).
**Next step** — one concrete action for today.
Keep it under 250 words. Write in the language the goal is written in.`;

function tools(ctx: ActionCtx) {
  return [
    betaZodTool({ ...searchAdsTool, run: (input) => searchAdsTool.run(ctx, input) }),
    betaZodTool({ ...searchProductsTool, run: (input) => searchProductsTool.run(ctx, input) }),
    betaZodTool({ ...listNichesTool, run: () => listNichesTool.run(ctx) }),
  ];
}

async function work(ctx: ActionCtx, agent: Doc<"agents">, lastBriefing: string | undefined): Promise<{ status: string; text: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: "error", text: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." };
  const client = claudeClient();
  const today = new Date().toISOString().slice(0, 10);
  const prompt = [
    `Agent: ${agent.name}`,
    `Goal: ${agent.goal}`,
    agent.niches.length ? `Focus niches: ${agent.niches.join(", ")}` : "Focus niches: any",
    `Today: ${today}`,
    lastBriefing ? `Previous briefing:\n${lastBriefing.slice(0, 1500)}` : "This is the first briefing.",
  ].join("\n");
  try {
    const final = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: tools(ctx),
      max_iterations: 8,
      messages: [{ role: "user", content: prompt }],
    });
    if (final.stop_reason === "refusal") return { status: "error", text: "The AI declined this goal. Try rewording it." };
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text ? { status: "ok", text: text.slice(0, 6000) } : { status: "error", text: "The AI didn't write a briefing this time." };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("Claude API error (agent)", error.status, error.message);
      return { status: "error", text: claudeErrorMessage(error, false) };
    }
    throw error;
  }
}

export const runOne = internalAction({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.agents.forRun, { id: args.agentId });
    if (!data || !data.agent.enabled) return;
    const result = await work(ctx, data.agent, data.lastBriefing);
    await ctx.runMutation(internal.agents.saveBriefing, { agentId: args.agentId, ...result });
  },
});

// Daily: every enabled agent, spread out so they don't all call Claude at once.
export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const max = Math.max(1, Number(process.env.AGENT_DAILY_MAX ?? 200) || 200);
    const ids: Id<"agents">[] = await ctx.runQuery(internal.agents.enabledIds, { limit: max });
    await Promise.all(ids.map((agentId, i) => ctx.scheduler.runAfter(i * 15_000, internal.agentRunner.runOne, { agentId })));
    return ids.length;
  },
});

// "Run now" from the Agents page; counts against the AI daily limit.
export const runNow = action({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<{ status: string; text: string }> => {
    const agent = await ctx.runQuery(internal.agents.ownedForRun, { id: args.agentId });
    if (!agent) throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
    const limit = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT ?? 30) || 30);
    const claim = await ctx.runMutation(internal.assistantUsage.claimMessage, { limit });
    if (!claim.allowed) throw new ConvexError({ code: "LIMIT", message: `You've used all ${limit} AI requests for today. Your agents still run tomorrow morning.` });
    const data = await ctx.runQuery(internal.agents.forRun, { id: args.agentId });
    const result = await work(ctx, agent, data?.lastBriefing);
    await ctx.runMutation(internal.agents.saveBriefing, { agentId: args.agentId, ...result });
    return result;
  },
});
