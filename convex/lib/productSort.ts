// All products → a search with "Sort by": the search index only returns matches by relevance, so the matches
// are sorted here, the same way the sort indexes order them (missing values last). Pure.

type Sortable = { aiScore?: number; adsCount?: number; likes?: number; growthPercent?: number; price?: number; marginPercent?: number; publishedAt?: string };

const KEYS: Record<string, (p: Sortable) => number | undefined> = {
  score: (p) => p.aiScore,
  ads: (p) => p.adsCount,
  likes: (p) => p.likes,
  growth: (p) => p.growthPercent,
  margin: (p) => p.marginPercent,
  priceHigh: (p) => p.price,
  priceLow: (p) => (p.price && p.price > 0 ? -p.price : undefined),
};

/** Whether a sort is applied on top of search results (relevance stays for "newest"). */
export const sortsSearch = (sort: string | undefined): sort is string => !!sort && sort in KEYS;

export function sortProducts<T extends Sortable>(items: T[], sort: string): T[] {
  const key = KEYS[sort];
  if (!key) return items;
  return [...items].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
}
