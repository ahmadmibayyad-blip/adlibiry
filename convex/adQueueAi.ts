"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claimAiRequest } from "./lib/aiQuota";

// Ad queue → "Make variations": three new versions of an ad (other hooks and angles, same product facts), which
// join the queue as pending for the user to approve. Counts against the AI daily limit.

const Variations = z.object({ ads: z.array(z.object({ angle: z.string(), hook: z.string(), primaryText: z.string(), headline: z.string() })) });

const SYSTEM =
  "You write Meta and TikTok ad copy for a small online store. Write 3 new variations of the ad you get: each a different angle " +
  "(e.g. problem/solution, social proof from the facts, gift, before/after, curiosity) and a new scroll-stopping first line (hook), " +
  "a primary text of 2-5 short lines and a headline of max 8 words. Keep the product facts; never invent reviews, numbers, " +
  "guarantees, medical or income claims. Write in the language given.";

export const variations = action({
  args: { id: v.id("adDrafts") },
  handler: async (ctx, args): Promise<{ added: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const c = await ctx.runQuery(internal.adQueue.forVariations, { id: args.id, token: stableToken(identity) });
    if (!c) throw new ConvexError({ code: "NOT_FOUND", message: "Ad not found." });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    await claimAiRequest(ctx);
    const d = c.draft;
    const facts = c.product
      ? `Product: ${c.product.title}. ${c.product.subtitle}\nBenefits: ${c.product.benefits.join("; ")}\nLanguage: ${c.product.language}`
      : "Language: the ad's own";
    try {
      const message = await claudeClient().messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: `${facts}\n\nThe ad (angle: ${d.angle}):\nHook: ${d.hook}\nText: ${d.primaryText}\nHeadline: ${d.headline}` }],
        output_config: { effort: "low", format: zodOutputFormat(Variations) },
      });
      const ads = (message.stop_reason === "refusal" ? [] : (message.parsed_output?.ads ?? [])).filter((a) => a.hook.trim() && a.primaryText.trim()).slice(0, 3);
      if (!ads.length) throw new ConvexError({ code: "AI_ERROR", message: "The AI didn't write variations. Try again." });
      await ctx.runMutation(internal.adQueue.addVariations, { from: d._id, ads });
      return { added: ads.length };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
