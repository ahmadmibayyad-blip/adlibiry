import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { mediaToHost } from "./lib/adMedia";

// Our copies of ad media (lib/adMedia.ts). adMediaAction.ts fetches the
// files; these read what's left to copy and save the results.

// Recently saved ads read when picking what to copy first.
const SAVED_SCANNED = 300;

type ToHost = { id: Id<"ads">; image?: string; video?: string };

const pick = (ad: Doc<"ads">, saved: boolean): ToHost | null => {
  const need = mediaToHost(ad, saved);
  if (!need.image && !need.video) return null;
  return { id: ad._id, ...(need.image ? { image: ad.creativeUrl } : {}), ...(need.video ? { video: ad.videoUrl } : {}) };
};

/** Saved ads first (with their videos while `videos`), then the newest ads not copied yet. */
export const nextToHost = internalQuery({
  args: { limit: v.number(), videos: v.boolean() },
  handler: async (ctx, args): Promise<ToHost[]> => {
    const out: ToHost[] = [];
    const seen = new Set<string>();
    for (const s of await ctx.db.query("savedAds").order("desc").take(SAVED_SCANNED)) {
      if (out.length >= args.limit) return out;
      if (seen.has(s.adId)) continue;
      seen.add(s.adId);
      const ad = await ctx.db.get("ads", s.adId);
      const item = ad && pick(ad, args.videos);
      if (item) out.push(item);
    }
    const fresh = await ctx.db
      .query("ads")
      .withIndex("by_media_status", (q) => q.eq("mediaStatus", undefined))
      .order("desc")
      .take(args.limit);
    for (const ad of fresh) {
      if (out.length >= args.limit) break;
      if (seen.has(ad._id)) continue;
      const item = pick(ad, false);
      // No usable image link: nothing to copy, ever.
      out.push(item ?? { id: ad._id });
    }
    return out;
  },
});

/** One saved ad, right after it's saved. */
export const toHostOne = internalQuery({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<ToHost | null> => {
    const ad = await ctx.db.get("ads", args.adId);
    return ad && pick(ad, true);
  },
});

const status = v.union(v.literal("done"), v.literal("failed"));

export const saveHosted = internalMutation({
  args: {
    results: v.array(
      v.object({
        id: v.id("ads"),
        image: v.optional(v.union(v.id("_storage"), v.literal("failed"), v.literal("none"))),
        video: v.optional(v.union(v.id("_storage"), status)),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const r of args.results) {
      const ad = await ctx.db.get("ads", r.id);
      const files = [r.image, r.video].filter((x): x is Id<"_storage"> => !!x && x !== "failed" && x !== "none" && x !== "done");
      if (!ad) {
        // Deleted while we fetched: don't keep its files.
        for (const f of files) await ctx.storage.delete(f);
        continue;
      }
      const patch: Partial<Doc<"ads">> = {};
      if (r.image === "failed" || r.image === "none") patch.mediaStatus = r.image;
      else if (r.image) {
        patch.hostedImageId = r.image;
        patch.hostedImageUrl = (await ctx.storage.getUrl(r.image)) ?? undefined;
        patch.mediaStatus = "done";
      } else if (ad.mediaStatus === undefined && !ad.hostedImageId) {
        patch.mediaStatus = "none";
      }
      if (r.video === "failed") patch.videoStatus = "failed";
      else if (r.video && r.video !== "done") {
        patch.hostedVideoId = r.video;
        patch.hostedVideoUrl = (await ctx.storage.getUrl(r.video)) ?? undefined;
        patch.videoStatus = "done";
      }
      await ctx.db.patch("ads", r.id, patch);
    }
  },
});

/** Removes an ad's copied files; call before deleting the ad. */
export async function deleteHostedMedia(ctx: MutationCtx, ad: Doc<"ads">) {
  for (const id of [ad.hostedImageId, ad.hostedVideoId]) {
    if (id) await ctx.storage.delete(id).catch(() => {});
  }
}
