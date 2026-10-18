"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claimAiRequest } from "./lib/aiQuota";
import { isTranscriptLanguage } from "./lib/transcriptLanguages";
import { VARIANT_SYSTEM, cleanVariant, variantPrompt, type Variant } from "./lib/videoAnalysis";

// Ad page → video analysis → "Write my version": a new script with a shot-by-
// shot timeline for the user's product, following the analysed ad's structure.
// Not saved; counts against the AI daily limit.

const Script = z.object({
  title: z.string(),
  hook: z.string(),
  lines: z.array(z.object({ start: z.number(), end: z.number(), scene: z.string(), onScreenText: z.string(), voiceover: z.string() })),
  cta: z.string(),
  notes: z.string(),
});

export const writeVariant = action({
  args: { adId: v.id("ads"), product: v.string(), angle: v.optional(v.string()), language: v.string() },
  handler: async (ctx, args): Promise<Variant> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const product = args.product.trim();
    if (product.length < 3) throw new ConvexError({ code: "BAD_REQUEST", message: "Describe your product first." });
    if (product.length > 1500 || (args.angle ?? "").length > 300) throw new ConvexError({ code: "BAD_REQUEST", message: "Keep the description shorter." });
    if (!isTranscriptLanguage(args.language)) throw new ConvexError({ code: "BAD_LANGUAGE", message: "Pick a language from the list." });
    const analysis = await ctx.runQuery(internal.videoAnalysis.analysisFor, { adId: args.adId });
    if (!analysis) throw new ConvexError({ code: "NOT_FOUND", message: "Analyse the video first." });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    await claimAiRequest(ctx);
    try {
      const message = await claudeClient().messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 4000,
        system: VARIANT_SYSTEM,
        messages: [{ role: "user", content: variantPrompt(analysis, product, args.language, args.angle ?? "") }],
        output_config: { effort: "low", format: zodOutputFormat(Script) },
      });
      const variant = message.stop_reason === "refusal" ? null : cleanVariant(message.parsed_output);
      if (!variant) throw new ConvexError({ code: "AI_ERROR", message: "The AI didn't write a script. Try again." });
      return variant;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
