// Our own copies of ad media (adMediaAction.ts): source CDN links (Meta's
// above all) expire after a while, which blanks saved ads and old ones in
// Ad Spy. Images of new ads and of saved ads are copied to Convex storage;
// videos only for saved ads, since they're large. The app keeps loading the
// source link and switches to our copy when it fails (src/lib/useMediaFallback.ts),
// so the copies cost storage, not bandwidth, while the links still work.
// Pure, unit tested.

export const IMAGE_MAX_BYTES = 5_000_000;
export const VIDEO_MAX_BYTES = 40_000_000;
export const DEFAULT_DAILY_IMAGES = 2000;
export const DEFAULT_DAILY_VIDEOS = 100;
export const HOST_BATCH = 40;

/** A positive whole number from an env var, else the default. */
export function dailyCap(raw: string | undefined, fallback: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type MediaAd = {
  creativeUrl?: string;
  videoUrl?: string;
  hostedImageId?: string;
  hostedVideoId?: string;
  mediaStatus?: string; // image: "done" | "none" | "failed"
  videoStatus?: string; // video: "done" | "failed"
};

const isWebUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** What's still to copy for this ad; videos only when someone saved it. */
export function mediaToHost(ad: MediaAd, saved: boolean): { image: boolean; video: boolean } {
  return {
    image: !ad.hostedImageId && ad.mediaStatus === undefined && isWebUrl(ad.creativeUrl),
    video: saved && !ad.hostedVideoId && ad.videoStatus === undefined && isWebUrl(ad.videoUrl),
  };
}

/** The response is the kind we want and small enough to keep. */
export function acceptableMedia(kind: "image" | "video", contentType: string | null, length: number): boolean {
  const type = (contentType ?? "").toLowerCase();
  const max = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  return type.startsWith(`${kind}/`) && length > 0 && length <= max;
}
