"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claimAiRequest } from "./lib/aiQuota";
import { isTranscriptLanguage } from "./lib/transcriptLanguages";

// Ad page → "What's said" → Translate: the video's transcript in another
// language. Kept on the ad, so each language is translated once for everyone;
// a new translation counts against the AI daily limit.

const SYSTEM =
  "You translate the spoken words of a video ad. Translate the transcript you get into the language given, keeping its meaning, tone " +
  "and line breaks; keep brand and product names as they are. Answer with the translation only, no notes.";

export const translate = action({
  args: { adId: v.id("ads"), language: v.string() },
  handler: async (ctx, args): Promise<{ text: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (!isTranscriptLanguage(args.language)) throw new ConvexError({ code: "BAD_LANGUAGE", message: "Pick a language from the list." });
    const ad = await ctx.runQuery(internal.transcripts.forTranslation, { id: args.adId });
    if (!ad) throw new ConvexError({ code: "NOT_FOUND", message: "This ad has no transcript yet." });
    const saved = ad.translations[args.language];
    if (saved) return { text: saved };
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    await claimAiRequest(ctx);
    try {
      const message = await claudeClient().messages.create({
        model: "claude-opus-5-5",
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: `Language: ${args.language}\n\nTranscript:\n${ad.transcript}` }],
        output_config: { effort: "low" },
      });
      const text = message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      if (!text || message.stop_reason === "refusal") throw new ConvexError({ code: "AI_ERROR", message: "The AI didn't translate it. Try again." });
      await ctx.runMutation(internal.transcripts.saveTranslation, { id: args.adId, language: args.language, text });
      return { text };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
