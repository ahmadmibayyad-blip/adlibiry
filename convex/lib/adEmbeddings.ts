// "Looks similar" ads: each ad image becomes a vector (Voyage AI's multimodal
// embeddings, VOYAGE_API_KEY) stored in adEmbeddings with a vector index, so an
// ad's nearest images can be looked up (convex/adEmbeddings.ts looksSimilar).
// Images are shrunk to EMBED_SIZE first: Voyage counts one token per 560 pixels,
// so a 256 px image costs ~120 tokens instead of ~2,000 for a 1080 px one.
// Pure parts, tested in adEmbeddings.test.ts.

export const VOYAGE_URL = "https://api.voyageai.com/v1/multimodalembeddings";
export const VOYAGE_MODEL = "voyage-multimodal-3.5";
export const EMBED_DIMENSIONS = 1024;
export const EMBED_SIZE = 256; // longest side, px
export const EMBED_BATCH = 48; // images per Voyage request
export const DEFAULT_DAILY_IMAGES = 3000; // VOYAGE_DAILY_IMAGES overrides

// Ads shown per lookup, and at most this many per advertiser so one brand's
// variations don't fill the list.
export const SIMILAR_SHOWN = 12;
export const SIMILAR_PER_ADVERTISER = 2;
// Cosine score below which an image isn't called similar. A first guess, not
// calibrated on our ads yet: unrelated photos tend to score well below it.
export const SIMILAR_MIN_SCORE = 0.5;

/** VOYAGE_DAILY_IMAGES as a number of images, else the default. */
export function dailyImageCap(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_IMAGES;
}

/** Request body for a batch of images (data URLs), embedded as documents. */
export function voyageBody(dataUrls: string[]) {
  return {
    model: VOYAGE_MODEL,
    input_type: "document",
    inputs: dataUrls.map((u) => ({ content: [{ type: "image_base64", image_base64: u }] })),
  };
}

/** Vectors from a Voyage reply, in request order; null if the reply isn't usable. */
export function parseVoyage(json: unknown, count: number): number[][] | null {
  const data = (json as { data?: { embedding?: unknown; index?: number }[] } | null)?.data;
  if (!Array.isArray(data) || data.length !== count) return null;
  const out: number[][] = new Array(count);
  for (const row of data) {
    const i = row?.index;
    const e = row?.embedding;
    if (typeof i !== "number" || i < 0 || i >= count || !Array.isArray(e) || e.length !== EMBED_DIMENSIONS) return null;
    if (!e.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
    out[i] = e as number[];
  }
  return out.every(Boolean) ? out : null;
}

/** A Voyage error in plain words; `stop` when every further call would fail the same way. */
export function describeVoyageError(status: number, body: unknown): { message: string; stop: boolean } {
  const detail = typeof (body as { detail?: unknown })?.detail === "string" ? ` (Voyage: ${(body as { detail: string }).detail.slice(0, 120)})` : "";
  if (status === 401 || status === 403) return { message: `Voyage refused the key (HTTP ${status}): check VOYAGE_API_KEY in Convex.${detail}`, stop: true };
  if (status === 402) return { message: `Voyage account is out of credit (HTTP 402).${detail}`, stop: true };
  if (status === 429) return { message: `Voyage is rate-limiting us (HTTP 429); the rest waits for tomorrow.${detail}`, stop: true };
  return { message: `Voyage error HTTP ${status}.${detail}`, stop: false };
}

/**
 * From vector-search hits (best first), the ads to show: not the ad itself,
 * not near-identical copies (shown under "Same creative"), at least
 * SIMILAR_MIN_SCORE, at most SIMILAR_PER_ADVERTISER per advertiser.
 */
export function pickSimilar<T extends { advertiserName: string }>(
  hits: { ad: T; score: number; sameImage: boolean; self: boolean }[],
  limit = SIMILAR_SHOWN,
): { ad: T; score: number }[] {
  const perAdvertiser = new Map<string, number>();
  const out: { ad: T; score: number }[] = [];
  for (const h of [...hits].sort((a, b) => b.score - a.score)) {
    if (out.length >= limit) break;
    if (h.self || h.sameImage || h.score < SIMILAR_MIN_SCORE) continue;
    const n = perAdvertiser.get(h.ad.advertiserName) ?? 0;
    if (n >= SIMILAR_PER_ADVERTISER) continue;
    perAdvertiser.set(h.ad.advertiserName, n + 1);
    out.push({ ad: h.ad, score: h.score });
  }
  return out;
}
