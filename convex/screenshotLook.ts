"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claudeClient } from "./lib/claudeClient";
import { claimAiRequest } from "./lib/aiQuota";
import { SCREENSHOT_DESIGN_GUIDE, cleanDesign, type DesignWishes } from "./lib/designWishes";
import { partsNote, screenshotProblem } from "./lib/screenshots";

// Launch → "Match a screenshot": the owner uploads a screenshot of a store they like, Claude reads its look
// (colors, fonts, corners, hero layout) and the dialog shows it before they launch; launch.start gets the result
// as `look` and the theme applies it over the style (lib/designWishes.ts). Counts against the AI daily limit.

const LookSchema = z.object({
  isPage: z.boolean(),
  accent: z.string().nullable(),
  background: z.string().nullable(),
  surface: z.string().nullable(),
  text: z.string().nullable(),
  roundness: z.string().nullable(),
  uppercase: z.boolean().nullable(),
  heroLayout: z.string().nullable(),
  headingFont: z.string().nullable(),
  bodyFont: z.string().nullable(),
});

const imageArg = v.object({ data: v.string(), mediaType: v.string() });

export const read = action({
  args: { images: v.array(imageArg) },
  handler: async (ctx, args): Promise<{ look: DesignWishes | null; message?: string }> => {
    const problem = screenshotProblem(args.images);
    if (problem) throw new ConvexError({ code: "BAD_REQUEST", message: problem });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    await claimAiRequest(ctx);
    const content: Anthropic.ContentBlockParam[] = [
      ...args.images.map((p): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: p.mediaType as "image/jpeg", data: p.data } })),
      { type: "text", text: `Read this store's look. ${partsNote(args.images.length)}`.trim() },
    ];
    let out: z.infer<typeof LookSchema> | null;
    try {
      const message = await claudeClient().messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 1500,
        system: SCREENSHOT_DESIGN_GUIDE,
        messages: [{ role: "user", content }],
        output_config: { effort: "low", format: zodOutputFormat(LookSchema) },
      });
      out = message.stop_reason === "refusal" ? null : message.parsed_output;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error (screenshot look)", error.status, error.message);
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
    if (!out) throw new ConvexError({ code: "AI_ERROR", message: "The AI couldn't read this screenshot. Try another one." });
    if (!out.isPage) return { look: null, message: "That doesn't look like a web page. Upload a screenshot of a store." };
    const look = cleanDesign(out) ?? null;
    return look ? { look } : { look: null, message: "We couldn't read colors or fonts from that screenshot. Try one of the store's home page." };
  },
});
