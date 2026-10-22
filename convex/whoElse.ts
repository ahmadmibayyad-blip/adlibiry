"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { claimAiRequest } from "./lib/aiQuota";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { EMBED_SIZE, VOYAGE_URL, parseVoyage, voyageBody } from "./lib/adEmbeddings";
import { parseKeywords, searchLanguage, storesFromImageHits, type ImageStore } from "./lib/offerSearch";

// Offer Search → a product → "Who else sells this" in a country: stores whose ads in AdSpy show the same product
// picture (Voyage image vectors, like Looks similar), and the words shoppers there use for it, to search Meta with.

const MAX_STORES = 12;

/** Stores in the country whose ads in AdSpy show the same product picture, best match first. */
export const samePicture = action({
  args: { imageUrl: v.string(), country: v.string(), excludeHost: v.string() },
  handler: async (ctx, args): Promise<{ stores: ImageStore[]; skipped?: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const key = process.env.VOYAGE_API_KEY?.trim();
    if (!key) return { stores: [], skipped: "Picture matching isn't set up yet (VOYAGE_API_KEY)." };
    if (!/^https:\/\//.test(args.imageUrl)) return { stores: [], skipped: "This product has no photo to match." };
    try {
      const img = await fetch(args.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!img.ok) return { stores: [], skipped: "The product photo couldn't be read." };
      const { Jimp } = await import("jimp");
      const pic = await Jimp.read(Buffer.from(await img.arrayBuffer()));
      pic.scaleToFit({ w: EMBED_SIZE, h: EMBED_SIZE });
      const dataUrl = `data:image/jpeg;base64,${(await pic.getBuffer("image/jpeg")).toString("base64")}`;
      const res = await fetch(VOYAGE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(voyageBody([dataUrl])),
        signal: AbortSignal.timeout(30_000),
      });
      const vector = parseVoyage(await res.json().catch(() => null), 1)?.[0];
      if (!res.ok || !vector) return { stores: [], skipped: "Picture matching didn't answer. Try again in a minute." };
      // Every country's ads share the index, so look wide and keep the country asked for.
      const hits = await ctx.vectorSearch("adEmbeddings", "by_embedding", { vector, limit: 256 });
      const { hits: loaded } = await ctx.runQuery(internal.adEmbeddings.adsForHits, {
        hits: hits.map((h) => ({ id: h._id as Id<"adEmbeddings">, score: h._score })),
      });
      const stores = storesFromImageHits(
        loaded.map((h) => ({ score: h.score, ad: { ...h.ad, _id: h.ad._id as string } })),
        args.country,
        args.excludeHost.replace(/^www\./, ""),
      );
      return { stores: stores.slice(0, MAX_STORES) };
    } catch (e) {
      console.warn("Who else: picture match failed", e instanceof Error ? e.message : e);
      return { stores: [], skipped: "Picture matching didn't work this time." };
    }
  },
});

const SYSTEM =
  "You help find other online shops selling a product in a country. Given what the product is, answer with 3 short search terms " +
  "(2-3 words each) that shops in that country's language write in their ads for it: the common name first, then other ways " +
  "people call it. One per line, no numbering, no brand names, no quotes, nothing else.";

/** The words shoppers and shops in the country use for the product (a small AI call, in the AI daily limit). */
export const keywords = action({
  args: { title: v.string(), supplierTitle: v.optional(v.string()), country: v.string() },
  handler: async (ctx, args): Promise<{ keywords: string[] }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const language = searchLanguage(args.country);
    if (!language) throw new ConvexError({ code: "BAD_COUNTRY", message: "Pick one of the listed countries." });
    const title = args.title.trim().slice(0, 200);
    if (!title) throw new ConvexError({ code: "BAD_REQUEST", message: "There's no product name to work from." });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    await claimAiRequest(ctx);
    try {
      const message = await claudeClient().messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 80,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Language: ${language}\nThe shop's product name: ${title}${args.supplierTitle ? `\nThe same product on AliExpress: ${args.supplierTitle.slice(0, 200)}` : ""}`,
          },
        ],
      });
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const words = parseKeywords(text);
      if (!words.length || message.stop_reason === "refusal") throw new ConvexError({ code: "AI_ERROR", message: "The AI didn't find words for it. Try again." });
      return { keywords: words };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
  },
});
