"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mapParallel } from "./imageHashAction";
import { DEFAULT_DAILY_IMAGES, DEFAULT_DAILY_VIDEOS, HOST_BATCH, IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, acceptableMedia, dailyCap } from "./lib/adMedia";

// Daily (importRuns job "adMedia") and right after an ad is saved: copies ad
// images, and saved ads' videos, into Convex storage (lib/adMedia.ts).
// MEDIA_DAILY_IMAGES (default 2,000) and MEDIA_DAILY_VIDEOS (default 100)
// cap a day's copying.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const TIME_BUDGET_MS = 8 * 60_000; // actions stop at 10 minutes

type Item = { id: Id<"ads">; image?: string; video?: string };
type Result = { id: Id<"ads">; image?: Id<"_storage"> | "failed" | "none"; video?: Id<"_storage"> | "failed" };

/** The file at url, stored; "failed" when it can't be fetched or isn't the right kind and size. */
async function copy(ctx: ActionCtx, url: string, kind: "image" | "video"): Promise<Id<"_storage"> | "failed"> {
  try {
    const max = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(kind === "image" ? 15_000 : 60_000) });
    const type = res.headers.get("content-type");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || declared > max) return "failed";
    const buf = await res.arrayBuffer();
    if (!acceptableMedia(kind, type, buf.byteLength)) return "failed";
    return await ctx.storage.store(new Blob([buf], { type: type ?? undefined }));
  } catch {
    return "failed";
  }
}

async function hostItems(ctx: ActionCtx, items: Item[], videosLeft: { n: number }): Promise<Result[]> {
  return mapParallel(items, async (item): Promise<Result> => {
    const out: Result = { id: item.id };
    out.image = item.image ? await copy(ctx, item.image, "image") : undefined;
    if (item.video && videosLeft.n > 0) {
      videosLeft.n--;
      out.video = await copy(ctx, item.video, "video");
    }
    return out;
  });
}

export const daily = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fetched: number; updated: number; errors: string[] }> => {
    const images = dailyCap(process.env.MEDIA_DAILY_IMAGES, DEFAULT_DAILY_IMAGES);
    const videosLeft = { n: dailyCap(process.env.MEDIA_DAILY_VIDEOS, DEFAULT_DAILY_VIDEOS) };
    const started = Date.now();
    const out = { fetched: 0, updated: 0, errors: [] as string[] };
    let failed = 0;
    while (out.fetched < images && Date.now() - started < TIME_BUDGET_MS) {
      const batch = await ctx.runQuery(internal.adMedia.nextToHost, { limit: Math.min(HOST_BATCH, images - out.fetched), videos: videosLeft.n > 0 });
      if (!batch.length) break;
      out.fetched += batch.length;
      const results = await hostItems(ctx, batch, videosLeft);
      // Each ad is handled once: with nothing to copy, or failing, it's marked so it isn't picked again.
      for (const r of results) if (!r.image && batch.find((b) => b.id === r.id && !b.image && !b.video)) r.image = "none";
      await ctx.runMutation(internal.adMedia.saveHosted, { results });
      out.updated += results.filter((r) => (r.image && r.image !== "failed" && r.image !== "none") || (r.video && r.video !== "failed")).length;
      failed += results.filter((r) => r.image === "failed" || r.video === "failed").length;
    }
    if (failed) out.errors.push(`${failed} ads' media couldn't be copied (expired or unreadable links); they won't be tried again.`);
    return out;
  },
});

/** Copies a just-saved ad's image and video, so it doesn't go blank later. */
export const hostSaved = internalAction({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.adMedia.toHostOne, { adId: args.adId });
    if (!item) return;
    const results = await hostItems(ctx, [item], { n: 1 });
    await ctx.runMutation(internal.adMedia.saveHosted, { results });
  },
});
