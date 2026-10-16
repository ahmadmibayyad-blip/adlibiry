// Product pages → On YouTube: review and unboxing videos about the product and how many people watched them,
// a sign of demand (YouTube Data API v3, YOUTUBE_API_KEY, free: 10,000 quota units a day; a search costs 100,
// the view counts 1). Pure: youtube.ts calls it.

export type YoutubeVideo = { id: string; title: string; channel: string; views: number; publishedAt: string; thumbnail?: string };
export type ProductVideos = { videos: YoutubeVideo[]; totalViews: number; checkedAt: string };

/** A search for the product's videos: its key words and "review". */
export function youtubeSearchUrl(keywords: string, key: string): string {
  return `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: "snippet", type: "video", maxResults: "15", q: `${keywords} review`, key })}`;
}
export const youtubeVideosUrl = (ids: string[], key: string) =>
  `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key })}`;

/** The video ids in a search answer. */
export function searchIds(body: unknown): string[] {
  const items = (body as { items?: { id?: { videoId?: unknown } }[] } | null)?.items ?? [];
  return [...new Set(items.map((i) => i.id?.videoId).filter((id): id is string => typeof id === "string"))];
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The videos with their view counts, most watched first, and the total. */
export function productVideos(body: unknown, now = new Date()): ProductVideos {
  const items = (body as { items?: unknown[] } | null)?.items ?? [];
  const videos = items.flatMap((x): YoutubeVideo[] => {
    const v = x as { id?: unknown; snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> }; statistics?: { viewCount?: string } };
    const views = Number(v.statistics?.viewCount);
    if (typeof v.id !== "string" || !v.snippet?.title || !Number.isFinite(views)) return [];
    const thumb = v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url;
    return [{
      id: v.id,
      title: decode(v.snippet.title).slice(0, 150),
      channel: decode(v.snippet.channelTitle ?? "").slice(0, 80),
      views,
      publishedAt: v.snippet.publishedAt ?? "",
      ...(thumb ? { thumbnail: thumb } : {}),
    }];
  });
  videos.sort((a, b) => b.views - a.views);
  return { videos: videos.slice(0, 10), totalViews: videos.reduce((s, v) => s + v.views, 0), checkedAt: now.toISOString() };
}

/** How recent the interest is: views of videos from the last 90 days. */
export function recentViews(p: ProductVideos, now = Date.now()): number {
  return p.videos.filter((v) => now - Date.parse(v.publishedAt) < 90 * 86_400_000).reduce((s, v) => s + v.views, 0);
}
