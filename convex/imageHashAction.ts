"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ADS_PER_ROUND, dHashFromGray, grayGrid } from "./lib/imageHash";

// Daily (crons.ts): hashes product and ad images that have no hash yet, so
// the product pipeline can spot one product imported from two sources.
// Each round hashes up to 100 products and 100 ads, then schedules the next.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const MAX_ROUNDS = 50; // up to ~5,000 ads a day; the rest wait for tomorrow
const MAX_BYTES = 15 * 1024 * 1024;
const PARALLEL = 8;

// "" when the image can't be fetched or decoded (expired CDN link, video,
// WebP…), so it isn't fetched again every round.
async function hashUrl(url: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return "";
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return "";
    // Loaded on first use: the library is large, and runs without images never need it.
    const { Jimp } = await import("jimp");
    const { data, width, height } = (await Jimp.read(buf)).bitmap;
    return dHashFromGray(grayGrid(data, width, height));
  } catch {
    return "";
  }
}

async function mapParallel<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

export const hashMissing = internalAction({
  // pipelineDay: started by the daily pipeline, which continues when this reports back.
  args: { cursor: v.union(v.string(), v.null()), productsDone: v.boolean(), round: v.number(), pipelineDay: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ products: number; ads: number }> => {
    let scheduledNext = false;
    let note: string | undefined;
    try {
      const batch = await ctx.runQuery(internal.imageHash.nextBatch, { cursor: args.cursor, productsDone: args.productsDone });
      const productHashes = await mapParallel(batch.products, async (p) => ({ ...p, hash: await hashUrl(p.url) }));
      const adHashes = await mapParallel(batch.ads, async (a) => ({ id: a.id, hash: await hashUrl(a.url) }));
      await ctx.runMutation(internal.imageHash.saveHashes, { products: productHashes, ads: adHashes });

      const more = !batch.productsDone || batch.ads.length === ADS_PER_ROUND;
      if (more && args.round + 1 < MAX_ROUNDS) {
        await ctx.scheduler.runAfter(0, internal.imageHashAction.hashMissing, {
          cursor: batch.cursor,
          productsDone: batch.productsDone,
          round: args.round + 1,
          pipelineDay: args.pipelineDay,
        });
        scheduledNext = true;
      }
      return { products: productHashes.length, ads: adHashes.length };
    } catch (e) {
      note = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      throw e;
    } finally {
      if (!scheduledNext && args.pipelineDay) {
        await ctx.runMutation(internal.productPipeline.actionDone, { day: args.pipelineDay, stage: "hashImages", note });
      }
    }
  },
});
