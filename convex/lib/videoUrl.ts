// Find a playable video file URL in a source's ad payload, whatever the field
// is called (video_url, play_url, video_info.play_addr.url_list[0], …).
// Only fields whose name mentions video/play are considered, and only
// http(s) links that aren't images.

const VIDEO_KEY = /video|play|mp4/i;
const IMAGE = /\.(jpe?g|png|webp|gif|heic)(\?|$)/i;

export function findVideoUrl(payload: unknown, depth = 0, underVideoKey = false): string | undefined {
  if (depth > 6 || payload == null) return undefined;
  if (typeof payload === "string") {
    return underVideoKey && /^https?:\/\//i.test(payload) && !IMAGE.test(payload) ? payload : undefined;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findVideoUrl(item, depth + 1, underVideoKey);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (/cover|poster|thumb|avatar|image|preview/i.test(key)) continue;
      const found = findVideoUrl(value, depth + 1, underVideoKey || VIDEO_KEY.test(key));
      if (found) return found;
    }
  }
  return undefined;
}
