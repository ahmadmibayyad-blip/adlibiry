// Research tab data, built from the app's own ads and products (see
// convex/research.ts). Pure functions so they can be tested directly.
//
// Trending keywords: product words and two-word phrases counted in NEW ads
// per week (by first-seen date) over the last 12 weeks. "Rising" means more
// new ads mention it this week than last week. This is advertiser activity
// in AdSpy Pro's data, not search interest.

export type AdLite = {
  title: string;       // product title or headline
  niche: string;
  platform: string;
  countries: string[]; // ISO codes
  firstSeenAt: string; // ISO
};

export type ProductLite = { category: string; aiScore: number; winnerRank?: number; linkedAds?: number };

export type TrendRow = {
  keyword: string;
  niche: string;
  direction: "Rising" | "Stable" | "Declining";
  risingPercent: number;
  weeklyInterest: number[];
  countryBreakdown: { country: string; interest: number }[];
  insight: string;
};

export type NicheRow = {
  name: string;
  icon: string;
  description: string;
  avgAiScore: number;
  productCount: number;
  trendDirection: "Rising" | "Stable" | "Declining";
  topCountries: string[];
};

const WEEKS = 12;
const WEEK_MS = 7 * 86_400_000;

// Words that say nothing about the product itself.
const STOP = new Set(
  (
    "the a an and or for with of in on to by your you our we it its is are be this that these those my me from at as all " +
    "new best free shipping sale off buy get now shop official store hot deal deals pcs pc set pack today only limited " +
    "offer order shop now click link bio here more just like love perfect great top quality premium gift gifts ideal " +
    "women men womens mens kids size color colour black white red blue green pink large small mini big pro plus max " +
    "tiktok facebook instagram amazon aliexpress 2024 2025 2026 day days week year use easy make made"
  ).split(" "),
);

export function keywordsOf(title: string): string[] {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const keep = (w: string) => !STOP.has(w) && w.length >= 4;
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    if (keep(words[i])) out.add(words[i]);
    if (i + 1 < words.length && !STOP.has(words[i]) && !STOP.has(words[i + 1])) {
      out.add(`${words[i]} ${words[i + 1]}`);
      if (i + 2 < words.length && !STOP.has(words[i + 2])) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }
  return [...out];
}

const top = <K>(counts: Map<K, number>, n: number) => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

function direction(thisWeek: number, lastWeek: number): { dir: TrendRow["direction"]; pct: number } {
  const pct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : thisWeek > 0 ? 100 : 0;
  const capped = Math.max(-100, Math.min(999, pct));
  return { dir: capped >= 20 ? "Rising" : capped <= -20 ? "Declining" : "Stable", pct: capped };
}

export function buildTrends(ads: AdLite[], now: number, limit = 36): TrendRow[] {
  type Acc = { weeks: number[]; niches: Map<string, number>; countries: Map<string, number>; platforms: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const ad of ads) {
    const age = now - Date.parse(ad.firstSeenAt);
    if (!(age >= 0) || age >= WEEKS * WEEK_MS) continue;
    const week = WEEKS - 1 - Math.floor(age / WEEK_MS); // 11 = this week
    for (const k of keywordsOf(ad.title)) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { weeks: Array(WEEKS).fill(0), niches: new Map(), countries: new Map(), platforms: new Map() }));
      a.weeks[week]++;
      inc(a.niches, ad.niche);
      inc(a.platforms, ad.platform);
      for (const c of ad.countries) inc(a.countries, c);
    }
  }

  const rows = [...acc.entries()]
    .filter(([, a]) => a.weeks[WEEKS - 1] + a.weeks[WEEKS - 2] >= 3) // enough recent ads to mean something
    .map(([keyword, a]) => {
      const thisWeek = a.weeks[WEEKS - 1];
      const lastWeek = a.weeks[WEEKS - 2];
      const { dir, pct } = direction(thisWeek, lastWeek);
      const max = Math.max(...a.weeks, 1);
      const countryTotal = [...a.countries.values()].reduce((s, n) => s + n, 0) || 1;
      const platform = top(a.platforms, 1)[0]?.[0];
      return {
        keyword,
        niche: top(a.niches, 1)[0]?.[0] ?? "Other",
        direction: dir,
        risingPercent: pct,
        weeklyInterest: a.weeks.map((w) => Math.round((w / max) * 100)),
        countryBreakdown: top(a.countries, 3).map(([country, n]) => ({ country, interest: Math.round((n / countryTotal) * 100) })),
        insight: `${thisWeek} new ad${thisWeek === 1 ? "" : "s"} this week vs ${lastWeek} last week${platform ? `, mostly on ${platform}` : ""}.`,
        momentum: thisWeek - lastWeek,
        volume: thisWeek + lastWeek,
      };
    });

  // Lead with what's gaining the most ads, then the busiest; on a tie the
  // longer phrase ("dog cooling mat" over "cooling mat") names it best.
  const words = (k: string) => k.split(" ").length;
  rows.sort((a, b) => b.momentum - a.momentum || b.volume - a.volume || words(b.keyword) - words(a.keyword));
  const picked: typeof rows = [];
  for (const r of rows) {
    // Skip a word or phrase already covered by a listed phrase.
    const mine = r.keyword.split(" ");
    if (picked.some((p) => mine.every((w) => p.keyword.split(" ").includes(w)))) continue;
    picked.push(r);
    if (picked.length >= limit) break;
  }
  return picked.map(({ momentum: _m, volume: _v, ...row }) => row);
}

export const NICHE_ICONS: Record<string, string> = {
  Beauty: "Sparkles",
  Fashion: "Shirt",
  Jewelry: "Gem",
  "Health & Wellness": "HeartPulse",
  Sports: "Dumbbell",
  "Home & Living": "Sofa",
  Electronics: "Cpu",
  "Pet Supplies": "PawPrint",
  "Baby & Kids": "Baby",
  Toys: "Blocks",
  Automotive: "Car",
  Other: "Package",
};

export function buildNiches(niches: readonly string[], products: ProductLite[], ads: AdLite[], now: number): NicheRow[] {
  return niches
    .map((name) => {
      const ps = products.filter((p) => p.category === name);
      const scores = ps.map((p) => p.aiScore).sort((a, b) => b - a).slice(0, 20);
      const avg = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
      const winners = ps.filter((p) => p.winnerRank !== undefined).length;
      const fromAds = ps.filter((p) => (p.linkedAds ?? 0) > 0).length;
      const nicheAds = ads.filter((a) => a.niche === name);
      const thisWeek = nicheAds.filter((a) => now - Date.parse(a.firstSeenAt) < WEEK_MS).length;
      const lastWeek = nicheAds.filter((a) => {
        const age = now - Date.parse(a.firstSeenAt);
        return age >= WEEK_MS && age < 2 * WEEK_MS;
      }).length;
      const countries = new Map<string, number>();
      const platforms = new Map<string, number>();
      for (const a of nicheAds) {
        for (const c of a.countries) inc(countries, c);
        inc(platforms, a.platform);
      }
      const platform = top(platforms, 1)[0]?.[0];
      const parts = [
        `${winners} winner${winners === 1 ? "" : "s"}`,
        fromAds ? `${fromAds} found in ads` : "",
        `${thisWeek} new ad${thisWeek === 1 ? "" : "s"} this week (${lastWeek} last week)`,
        platform ? `mostly ${platform}` : "",
      ].filter(Boolean);
      return {
        name,
        icon: NICHE_ICONS[name] ?? "Package",
        description: parts.join(" · ") + ".",
        avgAiScore: avg,
        productCount: ps.length,
        trendDirection: direction(thisWeek, lastWeek).dir,
        topCountries: top(countries, 3).map(([c]) => c),
        adCount: nicheAds.length,
      };
    })
    .filter((n) => n.productCount > 0 || n.adCount > 0)
    .map(({ adCount: _a, ...row }) => row);
}

// True for a bare site address ("https://www.aliexpress.com") that points to
// no product in particular.
export function isHomepageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "" || u.pathname === "/") && !u.search;
  } catch {
    return true;
  }
}
