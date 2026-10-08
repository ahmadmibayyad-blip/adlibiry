// Supplier reviews for a launch (launchRun.ts): real buyer reviews of the
// AliExpress listings the product comes from (up to 3 sellers of the same
// product), shown on the store's pages labelled as reviews from the
// supplier's buyers, with the listings' real average, count and star
// breakdown. We pick reviews with real text and leave out ones about
// shipping (the store's delivery is its own) or the marketplace.

export type SupplierReview = { name: string; country: string; rating: number; text: string; date: string; images: string[] };
export type SupplierReviews = {
  source: "aliexpress";
  average: number;
  total: number;
  /** How many buyers gave 5, 4, 3, 2 and 1 stars. */
  stars: number[];
  /** How many listings the reviews come from. */
  listings: number;
  items: SupplierReview[];
};
type Listing = { average: number; total: number; stars: number[]; items: SupplierReview[] };

export const MAX_LISTINGS = 3;

/** The AliExpress product id in a listing link ("…/item/1005012299631792.html"), or null. */
export function aliexpressId(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)aliexpress\.[a-z.]+$/.test(u.hostname)) return null;
  return u.pathname.match(/\/item\/(?:[^/]*\/)?(\d{8,})\.html/)?.[1] ?? u.searchParams.get("productId")?.match(/^\d{8,}$/)?.[0] ?? null;
}

/** The product ids in one or more links (one per line, or separated by spaces or commas), at most MAX_LISTINGS. */
export function aliexpressIds(text: string | undefined): string[] {
  const ids = (text ?? "").split(/[\s,]+/).map(aliexpressId).filter((id): id is string => !!id);
  return [...new Set(ids)].slice(0, MAX_LISTINGS);
}

export const reviewsEndpoint = (id: string) =>
  `https://feedback.aliexpress.com/pc/searchEvaluation.do?productId=${id}&lang=en_US&country=US&page=1&pageSize=40&filter=all&sort=complex_default`;

// Shipping and marketplace talk: true for the supplier, not for the store.
const OFF_TOPIC = /\b(ship|shipping|shipped|deliver\w*|arriv\w*|package|parcel|courier|tracking|customs|seller|store|aliexpress|refund|dispute|days? to|weeks? to|fast|quick(ly)?|slow)\b/i;

type Raw = {
  anonymous?: boolean;
  buyerName?: string;
  buyerCountry?: string;
  buyerEval?: number;
  buyerFeedback?: string;
  buyerTranslationFeedback?: string;
  evalDate?: string;
  images?: string[];
};
type Stats = { evarageStar?: number; totalNum?: number; fiveStarNum?: number; fourStarNum?: number; threeStarNum?: number; twoStarNum?: number; oneStarNum?: number };

/** One listing's stats and its reviews worth showing (4–5 stars, real text, on topic); null without reviews. */
export function parseListing(body: unknown): Listing | null {
  const data = (body as { data?: { evaViewList?: Raw[]; productEvaluationStatistic?: Stats } } | null)?.data;
  const st = data?.productEvaluationStatistic;
  const total = Math.round(st?.totalNum ?? 0);
  const average = st?.evarageStar ?? 0;
  if (!data || total <= 0 || average <= 0) return null;
  const n = (x: number | undefined) => Math.max(0, Math.round(x ?? 0));
  const items = (data.evaViewList ?? [])
    .map((r) => ({
      name: r.anonymous || !r.buyerName || /aliexpress/i.test(r.buyerName) ? "" : r.buyerName.slice(0, 20),
      country: /^[A-Z]{2}$/.test(r.buyerCountry ?? "") ? r.buyerCountry! : "",
      rating: Math.max(1, Math.min(5, Math.round((r.buyerEval ?? 0) / 20))),
      text: (r.buyerTranslationFeedback || r.buyerFeedback || "").replace(/\s+/g, " ").trim().slice(0, 400),
      date: (r.evalDate ?? "").slice(0, 20),
      images: (r.images ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 3),
    }))
    .filter((r) => r.rating >= 4 && r.text.length >= 20 && !OFF_TOPIC.test(r.text));
  return { average, total, stars: [n(st?.fiveStarNum), n(st?.fourStarNum), n(st?.threeStarNum), n(st?.twoStarNum), n(st?.oneStarNum)], items };
}

/** Several listings of the same product as one: summed counts, the average weighted by count, the best reviews. */
export function combineListings(listings: (Listing | null)[], max = 6): SupplierReviews | null {
  const found = listings.filter((l): l is Listing => !!l);
  const total = found.reduce((s, l) => s + l.total, 0);
  if (!total) return null;
  const seen = new Set<string>();
  const items = found
    .flatMap((l) => l.items)
    .filter((r) => {
      const key = r.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.rating - a.rating || b.images.length - a.images.length || b.text.length - a.text.length)
    .slice(0, max);
  if (!items.length) return null;
  return {
    source: "aliexpress",
    average: Math.round((found.reduce((s, l) => s + l.average * l.total, 0) / total) * 10) / 10,
    total,
    stars: [0, 1, 2, 3, 4].map((i) => found.reduce((s, l) => s + (l.stars[i] ?? 0), 0)),
    listings: found.length,
    items,
  };
}

/** One listing's reviews worth showing, with its stats; null when there are none. */
export const parseReviews = (body: unknown, max = 6) => combineListings([parseListing(body)], max);
