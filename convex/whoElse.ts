"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { claimAiRequest } from "./lib/aiQuota";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { EMBED_SIZE, VOYAGE_URL, parseVoyage, voyageBody } from "./lib/adEmbeddings";
import { parseKeywords, pictureMatch, searchLanguage } from "./lib/offerSearch";

// Offer Search → a product → "Who else sells this" in a country: the words to search Meta for (its made-up name, if
// it has one, and what shops there call it), then each found store's ad pictures compared with the product photo
// (Voyage image vectors) to tell the stores selling the same product from Meta's noise.

const PICTURES_PER_STORE = 3;
const VOYAGE_BATCH = 32;

async function dataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const { Jimp } = await import("jimp");
    const pic = await Jimp.read(Buffer.from(await res.arrayBuffer()));
    pic.scaleToFit({ w: EMBED_SIZE, h: EMBED_SIZE });
    return `data:image/jpeg;base64,${(await pic.getBuffer("image/jpeg")).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Each store's picture match with the product photo, saved on the search (scheduled when a product search finishes). */
export const matchPictures = internalAction({
  args: { id: v.id("offerSearches") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(internal.offerSearch.forPictures, { id: args.id });
    if (!row) return;
    const key = process.env.VOYAGE_API_KEY?.trim();
    if (!key) {
      await ctx.runMutation(internal.offerSearch.savePictures, { id: args.id, matches: {}, status: "skipped" });
      return;
    }
    // In order: the product photo, then each store's ad pictures.
    const wanted: { host: string | null; url: string }[] = [{ host: null, url: row.productImage }];
    for (const st of row.stores) for (const s of st.sample.slice(0, PICTURES_PER_STORE)) if (s.image) wanted.push({ host: st.host, url: s.image });
    const pics: (string | null)[] = [];
    for (let i = 0; i < wanted.length; i += 10) pics.push(...(await Promise.all(wanted.slice(i, i + 10).map((w) => dataUrl(w.url)))));
    const usable = wanted.map((w, i) => ({ ...w, pic: pics[i] })).filter((w): w is typeof w & { pic: string } => !!w.pic);
    // Without the product photo there's nothing to compare with: the page shows every store.
    if (!usable.length || usable[0].host !== null) {
      await ctx.runMutation(internal.offerSearch.savePictures, { id: args.id, matches: {}, status: "skipped" });
      return;
    }
    const vectors: number[][] = [];
    try {
      for (let i = 0; i < usable.length; i += VOYAGE_BATCH) {
        const batch = usable.slice(i, i + VOYAGE_BATCH);
        const res = await fetch(VOYAGE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(voyageBody(batch.map((b) => b.pic))),
          signal: AbortSignal.timeout(60_000),
        });
        const got = res.ok ? parseVoyage(await res.json().catch(() => null), batch.length) : null;
        if (!got) throw new Error(`Voyage ${res.status}`);
        vectors.push(...got);
      }
    } catch (e) {
      console.warn("Who else: picture check failed", e instanceof Error ? e.message : e);
      await ctx.runMutation(internal.offerSearch.savePictures, { id: args.id, matches: {}, status: "skipped" });
      return;
    }
    const product = vectors[0];
    const byHost = new Map<string, number[][]>();
    usable.forEach((u, i) => {
      if (u.host) byHost.set(u.host, [...(byHost.get(u.host) ?? []), vectors[i]]);
    });
    const matches: Record<string, number> = {};
    for (const [host, vs] of byHost) matches[host] = pictureMatch(product, vs);
    await ctx.runMutation(internal.offerSearch.savePictures, { id: args.id, matches, status: "done" });
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
