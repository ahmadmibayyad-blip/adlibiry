// Multi-source fusion: one record per ad/product, each field knowing which
// source wrote it, fixed priorities when sources disagree (the disagreement is
// logged, not guessed away), and an agreement count across independent
// source families that backs the "Verified winner" badge.

/** Who is best at what. Higher wins; a source missing from a list ranks 0. */
const RANK: Record<"live" | "advertiser" | "engagement", Record<string, number>> = {
  // Official registry beats a scraper on whether an ad is live and who runs it.
  live: { meta_ad_library: 3, adlibrary_api: 2, apify: 1 },
  advertiser: { meta_ad_library: 3, adlibrary_api: 2, apify: 1 },
  // Only scrapers and ad-spy feeds see engagement counters.
  engagement: { apify: 3, pipispy: 3, winninghunter: 3, nexscope: 3, extension: 2, csv_import: 1 },
};

export type FieldGroup = keyof typeof RANK;
export type Provenance = { source: string; at: string };
export type SourceFields = Partial<Record<FieldGroup, Provenance>>;
export type Conflict = { field: string; values: { source: string; value: string }[] };

const GROUP_KEYS: Record<FieldGroup, string[]> = {
  live: ["isActive"],
  advertiser: ["advertiserName", "advertiserAvatar"],
  engagement: ["likes", "views", "comments", "shares", "impressions"],
};

const rank = (group: FieldGroup, source: string | undefined) => (source ? (RANK[group][source] ?? 0) : -1);

/** "1.2M" / "35K" / "1,234" → number. */
export function parseCount(v: unknown): number {
  if (typeof v === "number") return v;
  const m = String(v ?? "").trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult) || 0;
}

const hasEngagement = (f: Record<string, unknown>) => GROUP_KEYS.engagement.some((k) => parseCount(f[k]) > 0);

type AdLike = Record<string, unknown> & { source?: string; sources?: string[]; sourceFields?: SourceFields };

/**
 * Merge an incoming sighting into the stored ad. Returns the keys to leave out
 * of the patch (a better source already owns them), the new provenance map and
 * source list, and any disagreements worth logging.
 */
export function fuseAd(existing: AdLike | null, incoming: Record<string, unknown>, source: string, day: string) {
  const prev: SourceFields = existing?.sourceFields ?? {};
  const fields: SourceFields = { ...prev };
  const drop: string[] = [];
  const conflicts: Conflict[] = [];
  for (const group of Object.keys(GROUP_KEYS) as FieldGroup[]) {
    const keys = GROUP_KEYS[group].filter((k) => incoming[k] !== undefined);
    if (!keys.length || (group === "engagement" && !hasEngagement(incoming))) {
      // Nothing (or only zeros) to say about this group: keep what we have.
      drop.push(...keys);
      continue;
    }
    // Rows from before provenance existed: the ad's own source wrote them.
    const owner = prev[group]?.source ?? (existing ? existing.source : undefined);
    const otherSource = !!existing && !!owner && owner !== source;
    // Two sources saying different things is kept, whichever one wins.
    if (otherSource && group !== "engagement") {
      const a = group === "live" ? existing.isActive : existing.advertiserName;
      const b = group === "live" ? incoming.isActive : incoming.advertiserName;
      const differ = group === "advertiser" ? String(a ?? "").trim().toLowerCase() !== String(b ?? "").trim().toLowerCase() : a !== undefined && a !== b;
      if (differ) conflicts.push({ field: group, values: [{ source: owner, value: String(a) }, { source, value: String(b) }] });
    }
    if (otherSource && rank(group, source) < rank(group, owner)) {
      drop.push(...keys);
      continue;
    }
    fields[group] = { source, at: day };
  }
  // Engagement that the ad's age can't explain (2M views on a 3-day-old ad).
  const views = parseCount(drop.includes("views") ? existing?.views : (incoming.views ?? existing?.views));
  const days = Number(incoming.daysRunning ?? existing?.daysRunning ?? 0);
  if (views >= 1_000_000 && days > 0 && days <= 5) {
    conflicts.push({
      field: "engagement_vs_age",
      values: [
        { source: fields.engagement?.source ?? source, value: `${views} views` },
        { source: fields.live?.source ?? source, value: `${days} days running` },
      ],
    });
  }
  const sources = [...new Set([...(existing?.sources ?? (existing?.source ? [existing.source] : [])), source])];
  return { drop, sourceFields: fields, sources, conflicts };
}

/** Price provenance (products.priceSource): the store's own page beats market data beats ad text. */
const PRICE_RANK: Record<string, number> = { landing_page: 3, exact: 2, ad_data: 1, estimated_market: 0 };
export function mayOverwritePrice(current: string | undefined, incoming: string): boolean {
  return current === undefined || (PRICE_RANK[incoming] ?? 0) >= (PRICE_RANK[current] ?? 0);
}

// ── Agreement across independent source families ───────────────────────────

export type Family = "registry" | "engagement" | "marketplace";
const FAMILY: Record<string, Family> = {
  meta_ad_library: "registry",
  adlibrary_api: "registry",
  apify: "engagement",
  pipispy: "engagement",
  winninghunter: "engagement",
  nexscope: "engagement",
  extension: "engagement",
  nexscope_api: "marketplace",
  tiktok_shop: "marketplace",
  shopify: "marketplace",
};
export const familyOf = (source: string): Family | undefined => FAMILY[source];

export type FusionInput = {
  productSource: string;
  unitsPerMonth?: number;
  /** Monthly sales of its Amazon twin, matched by image (fusion.ts trigger D). */
  twinUnitsPerMonth?: number;
  trend?: string;
  growthPercent?: number;
  momentum14?: number;
  activeAds: number;
  marginKnown: boolean;
  saturation?: string;
  ads: { sources: string[]; isActive?: boolean; isScaling?: boolean }[];
};
export type Fusion = { families: Family[]; adLevel: boolean; productLevel: boolean; confidence: number; crossValidated: boolean };

/**
 * Counting agreement, nothing more:
 * - ad level: a live ad in the official registry AND engagement rising (a
 *   scaling ad or 14-day views up),
 * - product level: marketplace demand AND ads scaling,
 * - cross-validated: both, plus a known margin and low saturation.
 */
export function fusion(p: FusionInput): Fusion {
  const families = new Set<Family>();
  for (const ad of p.ads) for (const s of ad.sources) {
    const f = familyOf(s);
    if (f && f !== "marketplace") families.add(f);
  }
  const marketplaceDemand =
    (familyOf(p.productSource) === "marketplace" && (p.unitsPerMonth ?? 0) > 0) || (p.twinUnitsPerMonth ?? 0) > 0;
  if (marketplaceDemand) families.add("marketplace");
  const liveOfficial = p.ads.some((a) => a.isActive !== false && a.sources.some((s) => familyOf(s) === "registry"));
  const scalingAds = p.ads.some((a) => a.isScaling) || (p.momentum14 ?? -1) > 0;
  const adLevel = liveOfficial && scalingAds;
  const demandRising = marketplaceDemand;
  const productLevel = demandRising && (scalingAds || p.activeAds >= 3);
  const confidence = Math.min(100, families.size * 20 + (adLevel ? 20 : 0) + (productLevel ? 20 : 0));
  const crossValidated = adLevel && productLevel && p.marginKnown && p.saturation === "Low";
  return { families: [...families].sort(), adLevel, productLevel, confidence, crossValidated };
}

/** Verified winner: passes the winner gates AND is cross-validated by at least two source families. */
export const isVerifiedWinner = (isWinner: boolean, f: { families: readonly string[]; crossValidated: boolean } | undefined) =>
  isWinner && !!f && f.crossValidated && f.families.length >= 2;

// ── Trigger B: a niche × country suddenly drawing new sellers ──────────────

/** Spike: advertisers at least doubled week over week, with at least `minNew` more. */
export function entrantSpikes(now: Record<string, number>, weekAgo: Record<string, number>, minNew = 5) {
  return Object.entries(now)
    .map(([key, n]) => ({ key, now: n, before: weekAgo[key] ?? 0 }))
    .filter((r) => r.before > 0 && r.now >= 2 * r.before && r.now - r.before >= minNew)
    .sort((a, b) => b.now - b.before - (a.now - a.before));
}

// ── Apify budget ────────────────────────────────────────────────────────────

export type Trigger = "winner" | "spike" | "backfill";
/** Budget order: winner admissions first, then saturation spikes, then backfill. */
export const TRIGGER_ORDER: Trigger[] = ["winner", "spike", "backfill"];
export function budgetLeft(spentToday: number, dailyBudget: number) {
  return Math.max(0, Math.round((dailyBudget - spentToday) * 100) / 100);
}

// ── Trigger C: what to search Meta's Ad Library for ─────────────────────────

const MARKETPLACE_HOSTS = /(^|\.)(amazon|tiktok|aliexpress|temu|ebay|etsy|walmart)\./i;
const FILLER = new Set(["the", "and", "for", "with", "a", "an", "of", "to", "in", "by", "new", "set", "pack", "pcs"]);

/** A shop's brand from its domain ("www.corecareshop.com" → "corecareshop"), else the first words of the title. */
export function backfillTerm(p: { title: string; storeHost?: string }): string {
  const host = p.storeHost?.replace(/^www\./, "");
  if (host && !MARKETPLACE_HOSTS.test(`.${host}`)) return host.split(".")[0];
  const words = p.title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter((w) => w.length > 1 && !FILLER.has(w.toLowerCase()));
  return words.slice(0, 4).join(" ");
}
