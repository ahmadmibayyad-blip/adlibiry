"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { NICHES } from "./lib/category";

// ── Image search ────────────────────────────────────────────────────────────
// A customer uploads a product photo; Claude says what the product is (name,
// search words, niche) and we search AdSpy Pro's own products and ads for it.
// Signed-in users only; counts against the AI daily limit.

const MAX_BYTES = 4_000_000; // base64 length; the page shrinks photos first

const Identified = z.object({
  isProduct: z.boolean(),
  productName: z.string(),
  searchTerms: z.array(z.string()),
  niche: z.enum(NICHES as unknown as [string, ...string[]]),
});

type Result = {
  identified: { productName: string; searchTerms: string[]; niche: string } | null;
  products: Doc<"products">[];
  ads: Doc<"ads">[];
};

export const search = action({
  args: { imageBase64: v.string(), mediaType: v.string() },
  handler: async (ctx, args): Promise<Result> => {
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    if (!/^image\/(jpeg|png|webp|gif)$/.test(args.mediaType)) throw new ConvexError({ code: "BAD_REQUEST", message: "Use a JPG, PNG, WebP or GIF image." });
    if (args.imageBase64.length > MAX_BYTES) throw new ConvexError({ code: "BAD_REQUEST", message: "That image is too large. Try a smaller one." });
    const limit = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT ?? 30) || 30);
    const claim = await ctx.runMutation(internal.assistantUsage.claimMessage, { limit });
    if (!claim.signedIn) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to search by image." });
    if (!claim.allowed) throw new ConvexError({ code: "LIMIT", message: `You've used all ${limit} AI requests for today. Come back tomorrow.` });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let found: z.infer<typeof Identified>;
    try {
      const response = await client.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 2000,
        output_config: { effort: "low", format: zodOutputFormat(Identified) },
        system:
          "You identify e-commerce products in photos for a product-research tool. Give a short generic product name (no brand unless it is the product), 3-5 short search terms a store would use in a product title (most specific first, 1-3 words each), and the best niche. If the photo shows no sellable product, set isProduct to false.",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: args.mediaType as "image/jpeg", data: args.imageBase64 } },
              { type: "text", text: "What product is this?" },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        throw new ConvexError({ code: "AI_ERROR", message: "The AI couldn't read this image. Try another photo." });
      }
      found = response.parsed_output;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error (image search)", error.status, error.message);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, false) });
      }
      throw error;
    }
    if (!found.isProduct) return { identified: null, products: [], ads: [] };

    const terms = [...new Set([found.productName, ...found.searchTerms].map((t) => t.trim()).filter(Boolean))].slice(0, 5);
    const products = new Map<string, Doc<"products">>();
    const ads = new Map<string, Doc<"ads">>();
    for (const term of terms) {
      if (products.size < 12) {
        const p = await ctx.runQuery(api.products.list, { paginationOpts: { numItems: 8, cursor: null }, search: term });
        for (const x of p.page) if (products.size < 12) products.set(x._id, x);
      }
      if (ads.size < 9) {
        const a = await ctx.runQuery(api.ads.list, { paginationOpts: { numItems: 6, cursor: null }, search: term });
        for (const x of a.page) if (ads.size < 9) ads.set(x._id, x);
      }
    }
    return {
      identified: { productName: found.productName, searchTerms: terms, niche: found.niche },
      products: [...products.values()],
      ads: [...ads.values()],
    };
  },
});
