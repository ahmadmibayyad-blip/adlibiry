// Screenshot to page → real photos: the page's placeholder images (placehold.co, with a short description as their
// text) are swapped for matching free photos from Pexels (PEXELS_API_KEY, free: 200 searches an hour), cropped to
// the placeholder's size. Pexels asks for a link to Pexels and, where possible, credit for the photographers. Pure.

export type Placeholder = { url: string; width: number; height: number; query: string };
export type PhotoCredit = { photographer: string; photographerUrl: string; pexelsUrl: string };

const PLACEHOLDER = /https:\/\/placehold\.co\/(\d{2,4})x(\d{2,4})[^"'\s)<>]*/g;
const FILLER = /\b(photo|image|picture|placeholder|of|a|an|the|with|and|showing|shot)\b/gi;

/** The page's placeholders, each once, with what they should show. */
export function placeholders(html: string): Placeholder[] {
  const seen = new Map<string, Placeholder>();
  for (const m of html.matchAll(PLACEHOLDER)) {
    const url = m[0].replace(/&amp;/g, "&");
    if (seen.has(m[0])) continue;
    let text: string;
    try {
      text = new URL(url).searchParams.get("text") ?? "";
    } catch {
      text = "";
    }
    const query = text.replace(/\+/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (query.length < 3) continue; // nothing to search for: stays a placeholder
    seen.set(m[0], { url: m[0], width: Number(m[1]), height: Number(m[2]), query });
  }
  return [...seen.values()];
}

export function pexelsSearchUrl(p: Placeholder): string {
  const ratio = p.width / p.height;
  const orientation = ratio > 1.2 ? "landscape" : ratio < 0.83 ? "portrait" : "square";
  return `https://api.pexels.com/v1/search?${new URLSearchParams({ query: p.query, orientation, per_page: "6" })}`;
}

type PexelsPhoto = { id: number; url?: string; photographer?: string; photographer_url?: string; src?: { original?: string } };

/** A photo from the search not used on the page yet, cropped to the placeholder's size (Pexels' image CDN takes w/h). */
export function pickPhoto(body: unknown, p: Placeholder, used: Set<number>): { src: string; credit: PhotoCredit } | null {
  const photos = ((body as { photos?: PexelsPhoto[] } | null)?.photos ?? []).filter((x) => x.src?.original && !used.has(x.id));
  const photo = photos[0];
  if (!photo?.src?.original) return null;
  used.add(photo.id);
  const w = Math.min(p.width * 2, 2400); // sharp on retina screens
  const h = Math.round((w / p.width) * p.height);
  return {
    src: `${photo.src.original.split("?")[0]}?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`,
    credit: { photographer: photo.photographer ?? "Pexels", photographerUrl: photo.photographer_url ?? "https://www.pexels.com", pexelsUrl: photo.url ?? "https://www.pexels.com" },
  };
}

/** The page with each placeholder that got a photo replaced (every place it appears). */
export function withPhotos(html: string, photos: Map<string, string>): string {
  let out = html;
  for (const [placeholder, src] of photos) out = out.split(placeholder).join(src);
  return out;
}
