import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mediaToHost } from "./lib/adMedia";
import { imageLinkExpiry } from "./lib/imageExpiry";

// Our copies of ad media (lib/adMedia.ts). adMediaAction.ts fetches the
// files; these read what's left to copy and save the results. A product made from
// an ad gets our copy of its picture too when its own photo link is a signed one that
// expires (TikTok and Facebook CDN links do, after days or weeks).

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
        if (ad.productId && patch.hostedImageUrl) await giveProductOurCopy(ctx, ad.productId, patch.hostedImageUrl);
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

/** A product photo that will stop working: none, or a signed CDN link (it carries its expiry). */
export const photoExpires = (url: string | undefined) => !url || imageLinkExpiry(url) !== null;

async function giveProductOurCopy(ctx: MutationCtx, productId: Id<"products">, hostedUrl: string) {
  const p = await ctx.db.get("products", productId);
  if (p && photoExpires(p.imageUrl)) await ctx.db.patch("products", p._id, { imageUrl: hostedUrl });
}

const REPAIR_BATCH = 100;

/**
 * One-off repair, then safe to run again: every product whose photo link expires gets the copy of one of its
 * ads' pictures. Walks the products table in batches and logs the totals at the end. Run from the Convex
 * dashboard: adMedia:repairProductImages with {}.
 */
export const repairProductImages = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), fixed: v.optional(v.number()), noCopy: v.optional(v.number()), checked: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("products").paginate({ cursor: args.cursor ?? null, numItems: REPAIR_BATCH });
    let fixed = args.fixed ?? 0;
    let noCopy = args.noCopy ?? 0;
    for (const p of page.page) {
      if (!photoExpires(p.imageUrl)) continue;
      const ads = await ctx.db.query("ads").withIndex("by_product", (q) => q.eq("productId", p._id)).take(20);
      const copy = ads.find((a) => a.hostedImageUrl)?.hostedImageUrl;
      if (copy) {
        await ctx.db.patch("products", p._id, { imageUrl: copy });
        fixed++;
      } else noCopy++;
    }
    const checked = (args.checked ?? 0) + page.page.length;
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.adMedia.repairProductImages, { cursor: page.continueCursor, fixed, noCopy, checked });
    else console.log(`Product photos: ${checked} products checked, ${fixed} now use our copy, ${noCopy} expiring with no copied ad picture`);
    return { checked, fixed, noCopy, done: page.isDone };
  },
});

/** Removes an ad's copied files; call before deleting the ad. The picture stays when its product shows it. */
export async function deleteHostedMedia(ctx: MutationCtx, ad: Doc<"ads">) {
  const product = ad.productId && ad.hostedImageUrl ? await ctx.db.get("products", ad.productId) : null;
  const productUsesImage = !!product && product.imageUrl === ad.hostedImageUrl;
  for (const id of [productUsesImage ? undefined : ad.hostedImageId, ad.hostedVideoId]) {
    if (id) await ctx.storage.delete(id).catch(() => {});
  }
}
