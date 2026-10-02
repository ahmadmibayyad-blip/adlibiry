// How an ad's video can be played: a stored file, or TikTok's official embed
// player for TikTok ads (imported with only a cover image, but with the
// TikTok video id in externalKey "tiktok_<id>" or in a tiktok.com link).

type VideoAd = { videoUrl?: string; externalKey?: string; platform: string; adLibraryUrl?: string; landingPageUrl: string };

export function tiktokVideoId(ad: VideoAd): string | null {
  if (ad.platform !== "TikTok") return null;
  const fromKey = ad.externalKey?.match(/^tiktok_(\d{15,22})$/)?.[1];
  if (fromKey) return fromKey;
  for (const url of [ad.adLibraryUrl, ad.landingPageUrl]) {
    const m = url?.match(/tiktok\.com\/.*\/video\/(\d{15,22})/);
    if (m) return m[1];
  }
  return null;
}

export const tiktokEmbedUrl = (id: string) => `https://www.tiktok.com/player/v1/${id}?music_info=0&description=0&rel=0`;

export const isPlayable = (ad: VideoAd) => !!ad.videoUrl || !!tiktokVideoId(ad);
