"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fetchImage, mapParallel } from "./imageHashAction";
import { isUsableHash } from "./lib/imageHash";
import { EMBED_BATCH, EMBED_SIZE, VOYAGE_URL, dailyImageCap, describeVoyageError, parseVoyage, voyageBody } from "./lib/adEmbeddings";

// Daily (importRuns job "adEmbeddings"): ad images → Voyage multimodal vectors
// for "Looks similar" (adEmbeddings.ts). Newest ads first, up to
// VOYAGE_DAILY_IMAGES a day (default 3,000); images are shrunk to 256 px
// before sending, since Voyage bills by pixel.

// Actions stop at 10 minutes and the budget is only checked between batches, so it leaves room for one slow
// batch: 24 images, 3 at a time, each fetch up to 10 s, then Voyage (up to 60 s) ≈ 2.5 minutes at worst.
const TIME_BUDGET_MS = 6 * 60_000;
const PER_LOOP = 24;
// Node actions get 512 MB. A decoded photo is width × height × 4 bytes (a 4000 px one ~64 MB), so only a few are
// decoded at once and big files are skipped: ad images are normally well under 1 MB.
const DECODE_PARALLEL = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// A 256 px JPEG data URL of the image, or null when it can't be read.
async function shrunk(url: string): Promise<string | null> {
  try {
    const buf = await fetchImage(url, MAX_IMAGE_BYTES);
    if (!buf) return null;
    const { Jimp } = await import("jimp");
    const img = await Jimp.read(buf);
    img.scaleToFit({ w: EMBED_SIZE, h: EMBED_SIZE });
    const jpeg = await img.getBuffer("image/jpeg");
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

export const dailyEmbed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; updated: number; errors: string[] }> => {
    const key = process.env.VOYAGE_API_KEY?.trim();
    if (!key) return { notConfigured: "VOYAGE_API_KEY isn't set (Looks similar)" };
    const cap = dailyImageCap(process.env.VOYAGE_DAILY_IMAGES);
    const started = Date.now();
    const out = { fetched: 0, updated: 0, errors: [] as string[] };

    while (out.fetched < cap && Date.now() - started < TIME_BUDGET_MS) {
      const batch = await ctx.runQuery(internal.adEmbeddings.nextToEmbed, { limit: Math.min(PER_LOOP, EMBED_BATCH, cap - out.fetched) });
      if (!batch.length) break;
      out.fetched += batch.length;
      // No image, or one the hash job already couldn't read: nothing to embed.
      const none = batch.filter((a) => !a.url || a.imageHash === "" || (a.imageHash !== undefined && !isUsableHash(a.imageHash))).map((a) => a.id);
      const todo = batch.filter((a) => !none.includes(a.id));
      const images = await mapParallel(todo, async (a) => ({ id: a.id, dataUrl: await shrunk(a.url) }), DECODE_PARALLEL);
      const readable = images.filter((i): i is { id: Id<"ads">; dataUrl: string } => i.dataUrl !== null);
      const failed = images.filter((i) => i.dataUrl === null).map((i) => i.id);

      let done: { id: Id<"ads">; embedding: number[] }[] = [];
      if (readable.length) {
        const res = await fetch(VOYAGE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(voyageBody(readable.map((r) => r.dataUrl))),
          signal: AbortSignal.timeout(60_000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const problem = describeVoyageError(res.status, body);
          out.errors.push(problem.message);
          // Key, credit or rate limit: leave these ads for the next run.
          if (problem.stop) {
            out.fetched -= batch.length;
            break;
          }
          failed.push(...readable.map((r) => r.id));
        } else {
          const vectors = parseVoyage(body, readable.length);
          if (!vectors) {
            out.errors.push("Voyage sent an answer we couldn't read; those ads were skipped.");
            failed.push(...readable.map((r) => r.id));
          } else {
            done = readable.map((r, i) => ({ id: r.id, embedding: vectors[i] }));
          }
        }
      }
      await ctx.runMutation(internal.adEmbeddings.saveEmbeddings, { done, none, failed });
      out.updated += done.length;
    }
    return out;
  },
});
