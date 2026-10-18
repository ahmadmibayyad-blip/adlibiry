"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import sharp from "sharp";
import { fetchImage, mapParallel } from "./imageHashAction";
import { isUsableHash } from "./lib/imageHash";
import { EMBED_BATCH, EMBED_SIZE, VOYAGE_URL, dailyImageCap, describeVoyageError, parseVoyage, voyageBody } from "./lib/adEmbeddings";

// Daily (importRuns job "adEmbeddings"): ad images → Voyage multimodal vectors
// for "Looks similar" (adEmbeddings.ts). Newest ads first, up to
// VOYAGE_DAILY_IMAGES a day (default 3,000); images are shrunk to 256 px
// before sending, since Voyage bills by pixel.

// Actions stop at 10 minutes and the budget is only checked between batches, so it leaves room for one slow
// batch: 24 downloads (8 at a time, up to 10 s each), decoding and Voyage (up to 60 s) ≈ 2 minutes at worst.
const TIME_BUDGET_MS = 6 * 60_000;
const PER_LOOP = 24;
// Node actions get 512 MB and a fraction of a CPU. sharp (libvips, an external package in convex.json) decodes
// JPEGs straight at a fraction of their size and keeps pixels outside the JS heap: on 24 real ad images it took
// 0.4 s and 110 MB, where Jimp took 8.6 s and 290 MB and stalled the action on full-size camera photos.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
sharp.cache(false);
sharp.concurrency(1);

// A 256 px JPEG data URL of the downloaded image, or null when it's too big or can't be read.
async function shrunk(buf: Buffer | null): Promise<string | null> {
  if (!buf) return null;
  try {
    const jpeg = await sharp(buf, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(EMBED_SIZE, EMBED_SIZE, { fit: "inside" })
      .jpeg()
      .toBuffer();
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
      const files = await mapParallel(todo, async (a) => ({ id: a.id, buf: await fetchImage(a.url, MAX_IMAGE_BYTES).catch(() => null) }));
      const images: { id: Id<"ads">; dataUrl: string | null }[] = [];
      for (const f of files) {
        images.push({ id: f.id, dataUrl: await shrunk(f.buf) });
        f.buf = null; // let it go before the next one is decoded
      }
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
