// How an ad's video can be played: a stored file, or TikTok's official embed
// player for TikTok ads (imported with only a cover image, but with the
// TikTok video id). Id lookup: convex/lib/tiktokVideo.ts.
import { tiktokVideoId } from "@/convex/lib/tiktokVideo.ts";

export { tiktokVideoId };

type VideoAd = Parameters<typeof tiktokVideoId>[0];

export const tiktokEmbedUrl = (id: string) => `https://www.tiktok.com/player/v1/${id}?music_info=0&description=0&rel=0`;

export const isPlayable = (ad: VideoAd) => !!ad.videoUrl || !!tiktokVideoId(ad);
