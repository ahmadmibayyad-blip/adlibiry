// Polite store reading (convex/storeSales.ts): respect robots.txt, compare a
// store's catalog with the last one, and read review counts from product
// pages. Pure functions, unit tested.

export const BOT_NAME = "AdSpyProBot";

/**
 * Whether robots.txt lets our crawler fetch `path`. Uses the group for our
 * bot if there is one, else "*"; the longest matching rule wins and Allow
 * beats Disallow on a tie (as Google does). No robots.txt = allowed.
 */
export function robotsAllows(robotsTxt: string, path: string, bot = BOT_NAME): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; length: number } | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    const length = r.pattern.length;
    if (!best || length > best.length || (length === best.length && r.allow)) best = { allow: r.allow, length };
  }
  return best ? best.allow : true;
}

// robots.txt patterns: "*" matches anything, a trailing "$" anchors the end.
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

// ── Catalog changes ─────────────────────────────────────────────────────────

export type CatalogEntry = { h: string; p: number; r?: number }; // handle, price (USD), review count
export type CatalogDiff = {
  added: number;
  removed: number;
  priceChanges: number;
  examples: { handle: string; change: "added" | "removed" | "price"; from?: number; to?: number }[];
};

export const MAX_CATALOG = 1000;

export function catalogDiff(previous: CatalogEntry[] | undefined, next: CatalogEntry[]): CatalogDiff | undefined {
  if (!previous) return undefined; // first check: nothing to compare with
  const before = new Map(previous.map((e) => [e.h, e]));
  const after = new Map(next.map((e) => [e.h, e]));
  const diff: CatalogDiff = { added: 0, removed: 0, priceChanges: 0, examples: [] };
  const note = (e: CatalogDiff["examples"][number]) => diff.examples.length < 10 && diff.examples.push(e);
  for (const [h, e] of after) {
    const old = before.get(h);
    if (!old) {
      diff.added++;
      note({ handle: h, change: "added", to: e.p });
    } else if (Math.abs(old.p - e.p) >= 0.01) {
      diff.priceChanges++;
      note({ handle: h, change: "price", from: old.p, to: e.p });
    }
  }
  for (const h of before.keys()) {
    if (!after.has(h)) {
      diff.removed++;
      note({ handle: h, change: "removed" });
    }
  }
  return diff;
}

// ── Reviews ─────────────────────────────────────────────────────────────────

/** Review count from a product page's structured data (JSON-LD aggregateRating), if present. */
export function reviewCountFromHtml(html: string): number | undefined {
  const m = html.match(/"(?:reviewCount|ratingCount)"\s*:\s*"?(\d{1,7})"?/);
  return m ? Number(m[1]) : undefined;
}

/** Reviews gained per week across products checked both times. */
export function reviewsPerWeek(previous: CatalogEntry[] | undefined, next: CatalogEntry[], weeks: number): number | undefined {
  if (!previous || weeks <= 0) return undefined;
  const before = new Map(previous.filter((e) => e.r !== undefined).map((e) => [e.h, e.r!]));
  let gained = 0;
  let compared = 0;
  for (const e of next) {
    const old = before.get(e.h);
    if (e.r === undefined || old === undefined) continue;
    compared++;
    gained += Math.max(0, e.r - old);
  }
  return compared ? Math.round((gained / weeks) * 10) / 10 : undefined;
}
