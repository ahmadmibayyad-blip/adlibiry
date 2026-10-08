// Supplier reviews for a launch (launchRun.ts): real buyer reviews of the
// AliExpress listing the product comes from, shown on the store's product
// page labelled as reviews from the supplier's buyers, with the listing's
// real average and count. We pick reviews with real text and leave out ones
// about shipping (the store's delivery is its own) or the marketplace.

export type SupplierReview = { name: string; country: string; rating: number; text: string; date: string; images: string[] };
export type SupplierReviews = { source: "aliexpress"; average: number; total: number; items: SupplierReview[] };

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

/** The listing's stats and the reviews worth showing (4–5 stars, real text, on topic), best first. */
export function parseReviews(body: unknown, max = 6): SupplierReviews | null {
  const data = (body as { data?: { evaViewList?: Raw[]; productEvaluationStatistic?: { evarageStar?: number; totalNum?: number } } } | null)?.data;
  const total = Math.round(data?.productEvaluationStatistic?.totalNum ?? 0);
  const average = Math.round((data?.productEvaluationStatistic?.evarageStar ?? 0) * 10) / 10;
  if (!data || total <= 0 || average <= 0) return null;
  const seen = new Set<string>();
  const items = (data.evaViewList ?? [])
    .map((r) => ({
      name: r.anonymous || !r.buyerName || /aliexpress/i.test(r.buyerName) ? "" : r.buyerName.slice(0, 20),
      country: /^[A-Z]{2}$/.test(r.buyerCountry ?? "") ? r.buyerCountry! : "",
      rating: Math.max(1, Math.min(5, Math.round((r.buyerEval ?? 0) / 20))),
      text: (r.buyerTranslationFeedback || r.buyerFeedback || "").replace(/\s+/g, " ").trim().slice(0, 400),
      date: (r.evalDate ?? "").slice(0, 20),
      images: (r.images ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 3),
    }))
    .filter((r) => {
      const key = r.text.toLowerCase();
      if (r.rating < 4 || r.text.length < 20 || OFF_TOPIC.test(r.text) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.rating - a.rating || b.images.length - a.images.length || b.text.length - a.text.length)
    .slice(0, max);
  return items.length ? { source: "aliexpress", average, total, items } : null;
}
