// Filters and sorts for Winning Products (Ad Spy-style panel). The list is
// small (at most WINNERS_PER_NICHE per niche), so it's filtered in memory.
// Pure, so it's unit-tested.

export type WinnerFilters = {
  search?: string;
  source?: string;
  minPrice?: number;
  maxPrice?: number;
  minMargin?: number; // percent
  minAiScore?: number;
  minAds?: number;
  minLikes?: number;
  trend?: string;
  saturation?: string;
  hasStoreLink?: boolean;
  newToday?: boolean;
  sort?: string; // "rank" (default) | "score" | "newest" | "ads" | "likes" | "margin" | "growth" | "revenue" | "priceLow" | "priceHigh"
};

type P = {
  title: string;
  description?: string;
  tags?: string[];
  source?: string;
  price?: number;
  cost?: number;
  marginPercent?: number;
  aiScore: number;
  adsCount?: number;
  linkedAds?: number;
  likes?: number;
  growthPercent?: number;
  trend: string;
  saturation: string;
  supplierUrl: string;
  storeUrl?: string;
  publishedAt: string;
  estRevenue?: { low: number; high: number };
};

export type WinnerItem<T extends P = P> = { position: number; nicheRank: number; isNewToday: boolean; product: T };

export const FILTER_KEYS = [
  "search", "source", "minPrice", "maxPrice", "minMargin", "minAiScore", "minAds",
  "minLikes", "trend", "saturation", "hasStoreLink", "newToday",
] as const;

/** True when the feed has to be filtered/sorted in memory instead of read straight from an index. */
export function needsFiltering(f: WinnerFilters): boolean {
  return FILTER_KEYS.some((k) => f[k] !== undefined && f[k] !== false && f[k] !== "") || (!!f.sort && f.sort !== "rank");
}

export function marginOf(p: P): number | undefined {
  if (p.price !== undefined && p.cost !== undefined && p.price > 0) return ((p.price - p.cost) / p.price) * 100;
  return p.marginPercent;
}

const adsOf = (p: P) => Math.max(p.adsCount ?? 0, p.linkedAds ?? 0);

export function filterAndSortWinners<I extends WinnerItem>(items: I[], f: WinnerFilters): I[] {
  const words = (f.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = items.filter(({ product: p, isNewToday }) => {
    if (words.length) {
      const hay = `${p.title} ${p.description ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (f.source && (p.source ?? "curated") !== f.source) return false;
    if (f.minPrice !== undefined && (p.price === undefined || p.price < f.minPrice)) return false;
    if (f.maxPrice !== undefined && (p.price === undefined || p.price > f.maxPrice)) return false;
    if (f.minMargin !== undefined) {
      const m = marginOf(p);
      if (m === undefined || m < f.minMargin) return false;
    }
    if (f.minAiScore !== undefined && p.aiScore < f.minAiScore) return false;
    if (f.minAds !== undefined && adsOf(p) < f.minAds) return false;
    if (f.minLikes !== undefined && (p.likes ?? 0) < f.minLikes) return false;
    if (f.trend && p.trend !== f.trend) return false;
    if (f.saturation && p.saturation !== f.saturation) return false;
    if (f.hasStoreLink && !(p.storeUrl || p.supplierUrl)) return false;
    if (f.newToday && !isNewToday) return false;
    return true;
  });

  // Missing values always sort last, whatever the direction.
  const by = (get: (p: P) => number | undefined, dir: 1 | -1 = -1) => (a: I, b: I) => {
    const x = get(a.product);
    const y = get(b.product);
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : 1) : -1;
    return dir * (x - y);
  };
  const sorters: Record<string, (a: I, b: I) => number> = {
    score: by((p) => p.aiScore),
    newest: by((p) => Date.parse(p.publishedAt) || undefined),
    ads: by((p) => adsOf(p) || undefined),
    likes: by((p) => p.likes),
    margin: by((p) => marginOf(p)),
    growth: by((p) => p.growthPercent),
    revenue: by((p) => p.estRevenue?.high),
    priceLow: by((p) => p.price, 1),
    priceHigh: by((p) => p.price),
  };
  const sort = f.sort && sorters[f.sort];
  // Stable: ties keep the feed's own order.
  return sort ? out.sort((a, b) => sort(a, b) || a.position - b.position) : out;
}
