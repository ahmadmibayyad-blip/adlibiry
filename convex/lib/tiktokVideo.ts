// TikTok video helpers shared by the server (download) and the page (player).

type VideoAd = { videoUrl?: string; externalKey?: string; platform: string; adLibraryUrl?: string; landingPageUrl: string };

// The TikTok video id, from the import key "tiktok_<id>" or a tiktok.com/…/video/<id> link.
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

// The video file link in a TikTok video page (the JSON TikTok embeds for its
// own app). Null when the page has none (private video, blocked, changed).
export function videoFileFromPage(html: string): string | null {
  const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const video = (data as any)?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct?.video;
  if (!video) return null;
  const candidates = [video.downloadAddr, video.playAddr, video.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0]];
  return candidates.find((u): u is string => typeof u === "string" && /^https:\/\//.test(u)) ?? null;
}

// "a=1; Path=/, b=2; Expires=Wed, 01 Oct 2026 …" → "a=1; b=2"
export function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
    .map((c) => c.trim().split(";")[0])
    .filter((c) => c.includes("="))
    .join("; ");
}
