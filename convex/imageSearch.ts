"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claudeClient } from "./lib/claudeClient";
import { NICHES } from "./lib/category";

// ── Image search ────────────────────────────────────────────────────────────
// A customer uploads a product photo; Claude says what the product is (name,
// search words, niche) and we search AdSpy Pro's own products and ads for it.
// Signed-in users only; counts against the AI daily limit.

const MAX_BYTES = 4_000_000; // base64 length; the page shrinks photos first

// Niche is a plain string (mapped to NICHES below) to keep the schema simple.
const Identified = z.object({
  isProduct: z.boolean(),
  productName: z.string(),
  searchTerms: z.array(z.string()),
  niche: z.string(),
});
type Found = z.infer<typeof Identified>;

const SYSTEM = `You identify e-commerce products in photos for a product-research tool. Give a short generic product name (no brand unless it is the product), 3-5 short search terms a store would use in a product title (most specific first, 1-3 words each), and the best niche, one of: ${NICHES.join(", ")}. If the photo shows no sellable product, set isProduct to false.`;

const toNiche = (n: string) => NICHES.find((x) => x.toLowerCase() === n.trim().toLowerCase()) ?? "Other";

// Ask Claude what the product is. Uses structured outputs; if the API rejects
// that request (400), asks again for plain JSON and validates it here.
async function identify(client: Anthropic, image: Anthropic.ImageBlockParam): Promise<Found | null> {
  const content: Anthropic.ContentBlockParam[] = [image, { type: "text", text: "What product is this?" }];
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Identified) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    return response.stop_reason === "refusal" ? null : response.parsed_output;
  } catch (error) {
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    console.error("Image search: structured output rejected, retrying as plain JSON", error.message);
  }
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: `${SYSTEM}\nReply with only a JSON object: {"isProduct": boolean, "productName": string, "searchTerms": string[], "niche": string}`,
    messages: [{ role: "user", content }],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = Identified.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
    if (!claim.allowed) throw new ConvexError({ code: "LIMIT", message: claim.message ?? "You've reached today's AI limit. Come back tomorrow." });

    const client = claudeClient();
    let found: Found | null;
    try {
      found = await identify(client, {
        type: "image",
        source: { type: "base64", media_type: args.mediaType as "image/jpeg", data: args.imageBase64 },
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error (image search)", error.status, error.message);
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
    if (!found) throw new ConvexError({ code: "AI_ERROR", message: "The AI couldn't read this image. Try another photo." });
    if (!found.isProduct) return { identified: null, products: [], ads: [] };

    const terms = [...new Set([found.productName, ...found.searchTerms].map((t) => t.trim()).filter(Boolean))].slice(0, 5);
    // Free and trial accounts see at most their per-list result limit.
    const resultLimit: number | null = await ctx.runQuery(api.billing.myResultLimit, {});
    const maxProducts = Math.min(12, resultLimit ?? 12);
    const maxAds = Math.min(9, resultLimit ?? 9);
    const products = new Map<string, Doc<"products">>();
    const ads = new Map<string, Doc<"ads">>();
    for (const term of terms) {
      if (products.size < maxProducts) {
        const p = await ctx.runQuery(internal.products.listInternal, { paginationOpts: { numItems: 8, cursor: null }, search: term });
        for (const x of p.page) if (products.size < maxProducts) products.set(x._id, x);
      }
      if (ads.size < maxAds) {
        const a = await ctx.runQuery(internal.ads.listInternal, { paginationOpts: { numItems: 6, cursor: null }, search: term });
        for (const x of a.page) if (ads.size < maxAds) ads.set(x._id, x);
      }
    }
    return {
      identified: { productName: found.productName, searchTerms: terms, niche: toNiche(found.niche) },
      products: [...products.values()],
      ads: [...ads.values()],
    };
  },
});
