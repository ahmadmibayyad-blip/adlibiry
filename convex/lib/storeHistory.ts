// Store Inspector → store age: when the Internet Archive's Wayback Machine (web.archive.org, free, no key) first and
// last saved the store's home page, and one saved copy per year to look back at. The first copy is a lower bound for
// the store's age: the archive only saves sites it finds. Pure (storeInspector.ts fetches).

export type StoreHistory = {
  /** Months in which the archive saved the home page at least once. */
  months: number;
  firstSeen?: string; // ISO date
  lastSeen?: string;
  /** One saved copy per year, oldest first, to open on web.archive.org. */
  years: { year: number; url: string }[];
};

/** One row per month the home page was saved (the CDX API, collapsed by month). */
export function cdxUrl(host: string): string {
  const q = new URLSearchParams({ url: host, output: "json", fl: "timestamp,statuscode", collapse: "timestamp:6" });
  return `https://web.archive.org/cdx/search/cdx?${q}`;
}

const isoOf = (ts: string) => (/^\d{8}/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : undefined);

/** The CDX answer ([["timestamp","statuscode"], ["20231227114120","-"], …], or [] when never saved). */
export function storeHistory(body: unknown, host: string): StoreHistory | null {
  if (!Array.isArray(body)) return null;
  const rows = body.slice(1).filter((r): r is [string, ...string[]] => Array.isArray(r) && typeof r[0] === "string" && /^\d{14}$/.test(r[0]));
  if (!rows.length) return { months: 0, years: [] };
  const stamps = rows.map((r) => r[0]).sort();
  // Per year the first copy that loaded (200) shows the store best; a redirect only if that's all there is.
  const byYear = new Map<number, string>();
  for (const year of new Set(stamps.map((ts) => Number(ts.slice(0, 4))))) {
    const ofYear = [...rows].sort((a, b) => a[0].localeCompare(b[0])).filter((r) => r[0].startsWith(String(year)));
    byYear.set(year, (ofYear.find((r) => r[1] === "200") ?? ofYear[0])[0]);
  }
  return {
    months: rows.length,
    firstSeen: isoOf(stamps[0]),
    lastSeen: isoOf(stamps[stamps.length - 1]),
    years: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, ts]) => ({ year, url: `https://web.archive.org/web/${ts}/https://${host}/` })),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How old the store looks, in words: "About 2 years (since Dec 2023)", "New: since Aug 2026". */
export function ageLabel(h: StoreHistory, now = Date.now()): string {
  if (!h.firstSeen) return "Not in the archive yet: most likely a new store";
  const first = Date.parse(h.firstSeen);
  const months = Math.max(0, Math.floor((now - first) / (30.44 * 86_400_000)));
  const d = new Date(first);
  const since = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (months < 3) return `New: first saved ${since}`;
  if (months < 12) return `About ${months} months old (first saved ${since})`;
  const years = Math.round(months / 12);
  return `About ${years} year${years === 1 ? "" : "s"} old (first saved ${since})`;
}
