"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { adPhotoPrompt } from "./lib/aiPhotos";
import { firstPhoto, generateImage } from "./lib/aiPhotoRun";
import { launchImages } from "./lib/launchCopy";
import { themeSecret, themeSignature } from "./lib/storeKit";

// Ad images for a launch: one portrait 4:5 picture per ad of its ad kit, made
// by Google's image model from the product's real photo (lib/aiPhotos.ts). The
// app writes the ad's hook and headline on it (AdImages.tsx) and downloads the
// result, so the text is always spelled right. The pictures are served with
// CORS from /launch/ad-image (http.ts) so the browser can draw them.

/** The signed /launch/ad-image link of a stored picture. */
export async function adImageUrl(id: string): Promise<string> {
  const site = process.env.CONVEX_SITE_URL ?? "";
  return `${site}/launch/ad-image?id=${encodeURIComponent(id)}&s=${await themeSignature(`ad-image:${id}`, themeSecret() ?? "")}`;
}

export const make = action({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args): Promise<{ made: number; note?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || !themeSecret()) throw new ConvexError({ code: "NOT_SET_UP", message: "Ad images aren't switched on yet." });
    const job = await ctx.runMutation(internal.launch.startAdImages, { launchId: args.launchId, token: stableToken(identity) });
    if ("error" in job) throw new ConvexError({ code: "NOT_ALLOWED", message: job.error ?? "Can't make ad images for this launch." });

    // Work from the real photo; the AI photos are a fallback when no real one downloads.
    const photo = await firstPhoto([...launchImages([job.product.imageUrl, ...job.product.images]), ...job.aiPhotoUrls]);
    if (!photo) {
      const note = "No ad images: the product has no photo we could download to work from.";
      await ctx.runMutation(internal.launch.saveAdImages, { launchId: args.launchId, images: [], note });
      return { made: 0, note };
    }
    type Made = { id: Id<"_storage">; url: string; angle: string; ad: number };
    let results: (Made | { error: string })[];
    try {
      // Made at the same time, stored one by one.
      const made = await Promise.all(job.adKit.map((ad) => generateImage(key, adPhotoPrompt(job.product, ad), photo, "4:5")));
      results = [];
      for (const [i, image] of made.entries()) {
        if ("error" in image) {
          results.push(image);
          continue;
        }
        const id = await ctx.storage.store(image);
        results.push({ id, url: await adImageUrl(id), angle: job.adKit[i].angle, ad: i });
      }
    } catch (e) {
      console.error("Ad images failed", e);
      results = job.adKit.map(() => ({ error: "crashed" }));
    }
    const images = results.filter((r): r is Made => "id" in r);
    const failed = results.length - images.length;
    if (failed) console.warn("Ad images failed", results.filter((r) => "error" in r).map((r) => ("error" in r ? r.error.slice(0, 200) : "")));
    const note = failed ? (images.length ? `${failed} of ${results.length} ad images couldn't be made.` : "The ad images couldn't be made this time. Try again.") : undefined;
    await ctx.runMutation(internal.launch.saveAdImages, { launchId: args.launchId, images, ...(note ? { note } : {}) });
    return { made: images.length, ...(note ? { note } : {}) };
  },
});
