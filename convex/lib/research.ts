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

export type ProductLite = { category: string; aiScore: number; winnerRank?: number; linkedAds?: number; publishedAt?: string };

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

// Too vague on their own ("custom", "case"), fine inside a phrase ("phone case").
const VAGUE = new Set(
  (
    "high daily anti custom support bundle home kit style design product products original natural care cute fashion beauty " +
    "case cover type ultra super smart soft portable electric fast long light lightweight waterproof adjustable reusable " +
    "body face outdoor indoor travel"
  ).split(" "),
);

export function keywordsOf(title: string): string[] {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const keep = (w: string) => !STOP.has(w) && !VAGUE.has(w) && w.length >= 4;
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
  const weekOf = (ad: AdLite) => {
    const age = now - Date.parse(ad.firstSeenAt);
    return age >= 0 && age < WEEKS * WEEK_MS ? WEEKS - 1 - Math.floor(age / WEEK_MS) : -1; // 11 = this week
  };
  // New ads per week across everything, so a busier week of imports doesn't
  // make every phrase look like it's rising: phrases are compared by their
  // share of all new ads.
  const totals: number[] = Array(WEEKS).fill(0);
  // First count phrases in this week's ads only, then keep details just for
  // phrases with enough of them: per-phrase maps for every phrase of 12 weeks
  // of ads ran the rebuild out of memory.
  const recent = new Map<string, number>();
  for (const ad of ads) {
    const w = weekOf(ad);
    if (w < 0) continue;
    totals[w]++;
    if (w === WEEKS - 1) for (const k of keywordsOf(ad.title)) inc(recent, k);
  }
  const keep = new Set([...recent].filter(([, n]) => n >= 3).map(([k]) => k));
  recent.clear();

  const acc = new Map<string, Acc>();
  for (const ad of ads) {
    const week = weekOf(ad);
    if (week < 0) continue;
    for (const k of keywordsOf(ad.title)) {
      if (!keep.has(k)) continue;
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { weeks: Array(WEEKS).fill(0), niches: new Map(), countries: new Map(), platforms: new Map() }));
      a.weeks[week]++;
      inc(a.niches, ad.niche);
      inc(a.platforms, ad.platform);
      for (const c of ad.countries) inc(a.countries, c);
    }
  }

  const BASE = 4; // weeks before this one that set the usual share
  const baseTotal = totals.slice(WEEKS - 1 - BASE, WEEKS - 1).reduce((s, n) => s + n, 0);
  const pctOf = (n: number, of: number) => (of ? (n / of) * 100 : 0);
  const rows = [...acc.entries()].map(([keyword, a]) => {
    const thisWeek = a.weeks[WEEKS - 1];
    const before = a.weeks.slice(WEEKS - 1 - BASE, WEEKS - 1).reduce((s, n) => s + n, 0);
    const share = pctOf(thisWeek, totals[WEEKS - 1]);
    const usual = pctOf(before, baseTotal);
    const pct = usual > 0 ? Math.max(-100, Math.min(999, Math.round((share / usual - 1) * 100))) : 100;
    const shares = a.weeks.map((n, w) => pctOf(n, totals[w]));
    const max = Math.max(...shares) || 1;
    const countryTotal = [...a.countries.values()].reduce((s, n) => s + n, 0) || 1;
    const platform = top(a.platforms, 1)[0]?.[0];
    const fmt = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));
    return {
      keyword,
      niche: top(a.niches, 1)[0]?.[0] ?? "Other",
      direction: (pct >= 20 ? "Rising" : pct <= -20 ? "Declining" : "Stable") as TrendRow["direction"],
      risingPercent: pct,
      weeklyInterest: shares.map((n) => Math.round((n / max) * 100)),
      countryBreakdown: top(a.countries, 3).map(([country, n]) => ({ country, interest: Math.round((n / countryTotal) * 100) })),
      insight:
        `${thisWeek} new ad${thisWeek === 1 ? "" : "s"} this week, ${fmt(share)}% of all new ads` +
        (usual > 0 ? ` (${fmt(usual)}% the 4 weeks before)` : " (none the 4 weeks before)") +
        (platform ? `, mostly on ${platform}.` : "."),
      // Ads above what its usual share would give this week; phrases name a product better than single words.
      excess: (thisWeek - (usual / 100) * totals[WEEKS - 1]) * (1 + 0.5 * (keyword.split(" ").length - 1)),
      volume: thisWeek,
    };
  });

  const words = (k: string) => k.split(" ").length;
  rows.sort((a, b) => b.excess - a.excess || b.volume - a.volume || words(b.keyword) - words(a.keyword));
  const picked: typeof rows = [];
  for (const r of rows) {
    // Skip a word or phrase already covered by a listed phrase.
    const mine = r.keyword.split(" ");
    if (picked.some((p) => mine.every((w) => p.keyword.split(" ").includes(w)))) continue;
    picked.push(r);
    if (picked.length >= limit) break;
  }
  return picked.map(({ excess: _e, volume: _v, ...row }) => row);
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
  const ageOf = (a: AdLite) => now - Date.parse(a.firstSeenAt);
  const isThisWeek = (a: AdLite) => ageOf(a) >= 0 && ageOf(a) < WEEK_MS;
  const isLastWeek = (a: AdLite) => ageOf(a) >= WEEK_MS && ageOf(a) < 2 * WEEK_MS;
  // Trend by share of all new ads, so a bigger week of imports doesn't lift every category.
  const allThis = ads.filter(isThisWeek).length || 1;
  const allLast = ads.filter(isLastWeek).length || 1;
  return niches
    .map((name) => {
      const ps = products.filter((p) => p.category === name);
      const scores = ps.map((p) => p.aiScore).sort((a, b) => b - a).slice(0, 20);
      const avg = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
      const winners = ps.filter((p) => p.winnerRank !== undefined).length;
      const fromAds = ps.filter((p) => (p.linkedAds ?? 0) > 0).length;
      const nicheAds = ads.filter((a) => a.niche === name);
      const thisWeek = nicheAds.filter(isThisWeek).length;
      const lastWeek = nicheAds.filter(isLastWeek).length;
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
        trendDirection: direction(thisWeek / allThis, lastWeek / allLast).dir,
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

// ── Dashboard numbers (home page) ───────────────────────────────────────────
export type DashboardStats = {
  adsPerDay: { day: string; value: number }[];      // new ads per day, last 30 days
  productsPerDay: { day: string; value: number }[]; // new products per day, last 30 days
  topNiches: { niche: string; thisWeek: number; lastWeek: number }[];
};

const DAY_MS = 86_400_000;

function perDay(dates: (string | undefined)[], now: number, days: number) {
  const today = Math.floor(now / DAY_MS);
  const counts = Array(days).fill(0) as number[];
  for (const d of dates) {
    const t = d ? Date.parse(d) : NaN;
    if (!(t <= now)) continue;
    const i = days - 1 - (today - Math.floor(t / DAY_MS));
    if (i >= 0 && i < days) counts[i]++;
  }
  return counts.map((value, i) => ({ day: new Date((today - (days - 1 - i)) * DAY_MS).toISOString().slice(0, 10), value }));
}

export function buildDashboard(ads: AdLite[], products: ProductLite[], now: number, days = 30): DashboardStats {
  const niches = new Map<string, { thisWeek: number; lastWeek: number }>();
  for (const a of ads) {
    const age = now - Date.parse(a.firstSeenAt);
    if (!(age >= 0) || age >= 2 * WEEK_MS) continue;
    const n = niches.get(a.niche) ?? { thisWeek: 0, lastWeek: 0 };
    if (age < WEEK_MS) n.thisWeek++;
    else n.lastWeek++;
    niches.set(a.niche, n);
  }
  return {
    adsPerDay: perDay(ads.map((a) => a.firstSeenAt), now, days),
    productsPerDay: perDay(products.map((p) => p.publishedAt), now, days),
    topNiches: [...niches.entries()]
      .map(([niche, n]) => ({ niche, ...n }))
      .filter((n) => n.thisWeek > 0)
      .sort((a, b) => b.thisWeek - a.thisWeek)
      .slice(0, 6),
  };
}
