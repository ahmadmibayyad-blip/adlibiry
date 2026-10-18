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
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { EMBED_SIZE, SIMILAR_SHOWN, VOYAGE_URL, parseVoyage, pickSimilar, voyageBody } from "./lib/adEmbeddings";
import { PICTURE_ACTOR, fromPictureSearch, pictureLimit, type PictureMatch } from "./lib/aliexpress";

// ── Image search ────────────────────────────────────────────────────────────
// A customer uploads a product photo; Claude says what the product is (name,
// search words, niche) and we search AdSpy Pro's own products and ads for it.
// Alongside, the photo itself is matched: against every embedded ad image
// ("Looks similar", needs VOYAGE_API_KEY) and on AliExpress through Apify.
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
  /** Ads whose image looks like the photo ("Looks similar" vectors), best first; empty without VOYAGE_API_KEY. */
  lookAlikes: Doc<"ads">[];
  /** AliExpress listings that look like the photo (Apify picture search); empty when off or over the daily cap. */
  suppliers: PictureMatch[];
};

// The photo as a "Looks similar" vector, then the nearest ad images. Never throws: no key or a failure = no look-alikes.
async function lookAlikeAds(ctx: ActionCtx, base64: string): Promise<Doc<"ads">[]> {
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) return [];
  try {
    const { Jimp } = await import("jimp");
    const img = await Jimp.read(Buffer.from(base64, "base64"));
    img.scaleToFit({ w: EMBED_SIZE, h: EMBED_SIZE });
    const dataUrl = `data:image/jpeg;base64,${(await img.getBuffer("image/jpeg")).toString("base64")}`;
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(voyageBody([dataUrl])),
      signal: AbortSignal.timeout(30_000),
    });
    const vector = parseVoyage(await res.json().catch(() => null), 1)?.[0];
    if (!res.ok || !vector) return [];
    const hits = await ctx.vectorSearch("adEmbeddings", "by_embedding", { vector, limit: 48 });
    const { hits: loaded, limit } = await ctx.runQuery(internal.adEmbeddings.adsForHits, {
      hits: hits.map((h) => ({ id: h._id as Id<"adEmbeddings">, score: h._score })),
    });
    return pickSimilar(loaded, Math.min(SIMILAR_SHOWN, limit ?? SIMILAR_SHOWN)).map((p) => p.ad);
  } catch (e) {
    console.warn("Image search: look-alike ads failed", e);
    return [];
  }
}

// AliExpress's visual search on the photo through Apify (~$0.006). The actor needs a link, so the photo sits in
// file storage for the call and is deleted right after. Never throws.
async function aliexpressLookAlikes(ctx: ActionCtx, base64: string): Promise<PictureMatch[]> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token || !(await ctx.runMutation(internal.aliexpressImage.claimDay, { limit: pictureLimit() }))) return [];
  const fileId = await ctx.storage.store(new Blob([Buffer.from(base64, "base64")], { type: "image/jpeg" }));
  try {
    const imageUrl = await ctx.storage.getUrl(fileId);
    if (!imageUrl) return [];
    const q = new URLSearchParams({ token, timeout: "60", maxTotalChargeUsd: "0.02" });
    const res = await fetch(`https://api.apify.com/v2/acts/${PICTURE_ACTOR}/run-sync-get-dataset-items?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, destination: "aliexpress", language: "en", currency: "USD" }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) {
      console.warn("Image search: Apify picture search", res.status, (await res.text()).slice(0, 200));
      return [];
    }
    return fromPictureSearch(await res.json().catch(() => null));
  } catch (e) {
    console.warn("Image search: AliExpress look-alikes failed", e);
    return [];
  } finally {
    await ctx.storage.delete(fileId);
  }
}

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
    // Picture matching runs alongside the AI; neither waits for the other.
    const visual = Promise.all([lookAlikeAds(ctx, args.imageBase64), aliexpressLookAlikes(ctx, args.imageBase64)]);
    let found: Found | null;
    try {
      found = await identify(client, {
        type: "image",
        source: { type: "base64", media_type: args.mediaType as "image/jpeg", data: args.imageBase64 },
      });
    } catch (error) {
      await visual;
      if (error instanceof Anthropic.APIError) {
        console.error("Claude API error (image search)", error.status, error.message);
        const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
        throw new ConvexError({ code: "AI_ERROR", message: claudeErrorMessage(error, user?.role === "admin") });
      }
      throw error;
    }
    const [lookAlikes, suppliers] = await visual;
    if (!found) throw new ConvexError({ code: "AI_ERROR", message: "The AI couldn't read this image. Try another photo." });
    if (!found.isProduct) return { identified: null, products: [], ads: [], lookAlikes, suppliers };

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
      // Ads already shown as look-alikes aren't repeated.
      ads: [...ads.values()].filter((a) => !lookAlikes.some((l) => l._id === a._id)),
      lookAlikes,
      suppliers,
    };
  },
});
