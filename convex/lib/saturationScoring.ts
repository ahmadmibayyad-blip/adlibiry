// Pure scoring math for the Country Saturation Analyzer. No database or AI
// calls here — every function is deterministic and unit-testable so the
// scores stay grounded in real signals, never AI guesses.

/** Diminishing-returns curve: 0 at n=0, 50 at n=half, approaches 100 as n grows. */
export function saturationCurve(n: number, half: number): number {
  if (n <= 0) return 0;
  return Math.round((100 * n) / (n + half));
}

/** Parses compact counts like "1.2M", "540K", "8.3M" into a raw number. */
export function parseCompactNumber(raw: string): number {
  const match = raw.trim().match(/^([\d.]+)\s*([KMB]?)$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = match[2].toUpperCase();
  const multiplier = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
  return num * multiplier;
}

/** Recent activity should count more than old activity. */
export function recencyWeight(firstSeenAtIso: string, nowMs: number): number {
  const ageDays = (nowMs - new Date(firstSeenAtIso).getTime()) / 86_400_000;
  if (ageDays <= 30) return 1.5;
  if (ageDays <= 90) return 1.0;
  return 0.5;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export type WeightedComponent = { score: number | null; weight: number; name: string };

/** Weighted average over only the components that had real underlying data. */
export function weightedAverage(components: WeightedComponent[]): number {
  const available = components.filter((c): c is WeightedComponent & { score: number } => c.score !== null);
  if (available.length === 0) return 0;
  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = available.reduce((sum, c) => sum + c.score * c.weight, 0);
  return Math.round(weightedSum / totalWeight);
}

export function saturationLabel(score: number): string {
  if (score <= 10) return "Almost no competition";
  if (score <= 20) return "Very low saturation";
  if (score <= 30) return "Low saturation";
  if (score <= 40) return "Low–moderate saturation";
  if (score <= 50) return "Moderate saturation";
  if (score <= 60) return "Increasing competition";
  if (score <= 70) return "High competition";
  if (score <= 80) return "Very saturated";
  if (score <= 90) return "Extremely saturated";
  return "Oversaturated";
}

export function demandLabel(score: number): string {
  if (score <= 20) return "Almost no visible demand";
  if (score <= 40) return "Low demand";
  if (score <= 60) return "Moderate demand";
  if (score <= 80) return "High demand";
  return "Extremely strong demand";
}

export function opportunityLabel(score: number): string {
  if (score <= 20) return "Poor opportunity";
  if (score <= 40) return "Weak opportunity";
  if (score <= 60) return "Fair opportunity";
  if (score <= 80) return "Strong opportunity";
  return "Early-mover opportunity";
}

/** Opportunity rewards high demand and penalizes high saturation. */
export function computeOpportunityScore(demandScore: number, saturationScore: number): number {
  return clamp(Math.round(0.55 * demandScore + 0.45 * (100 - saturationScore)), 0, 100);
}

// ── Shared per-country scoring, reused by the single-check and comparison actions ──

export type CountryAdSignal = { advertiserName: string; firstSeenAt: string; views: string };

/** An ad counts for a country if it targets it (main country or one of its countries). */
export function adInCountry(ad: { country: string; countries?: string[] }, country: string): boolean {
  return ad.country === country || (ad.countries ?? []).includes(country);
}
export type CountryStoreSignal = { activeAdsCount: number };

export type ScoreCountryInput = {
  localAds: CountryAdSignal[];
  globalAdvertiserCount: number;
  localStores: CountryStoreSignal[];
  trendCountryInterest?: number;
  trendDirection?: string;
  trendRisingPercent?: number;
  avgSupplierSellers?: number;
  hasTrendData: boolean;
  hasSupplierData: boolean;
  now: number;
  // Only our own tracked ads (the analyzer's default): stores, trends and
  // supplier listings aren't used, and confidence comes from how many ads back the check.
  adsOnly?: boolean;
};

export type CountryScoreSignals = {
  localAdvertiserCount: number;
  localActiveAds: number;
  recentLocalAdvertisers30d: number;
  globalAdvertiserCount: number;
  localStoreCount: number;
  localStoreActiveAds: number;
  supplierSellerCount?: number;
  trendInterest?: number;
  trendDirection?: string;
  trendRisingPercent?: number;
  sourcesAnalyzed: string[];
  sourcesUnavailable: string[];
};

export type ScoreCountryResult = {
  saturationScore: number;
  demandScore: number;
  opportunityScore: number;
  confidenceScore: number;
  signals: CountryScoreSignals;
};

/** Computes every score + signal for one country from already-fetched real data. Pure and unit-testable. */
export function scoreCountry(input: ScoreCountryInput): ScoreCountryResult {
  const localAdvertisers = new Set(input.localAds.map((a) => a.advertiserName));
  const recentLocalAdvertisers = new Set(
    input.localAds.filter((a) => recencyWeight(a.firstSeenAt, input.now) >= 1.5).map((a) => a.advertiserName)
  );

  const sourcesAnalyzed: string[] = input.adsOnly
    ? ["Ad Spy: our own tracked ads (distinct advertisers in this country)"]
    : ["Ad Spy (tracked Meta/TikTok ads)", "Store Tracker (Shopify stores)"];
  const sourcesUnavailable: string[] = [];
  if (!input.adsOnly) {
    if (input.hasTrendData) sourcesAnalyzed.push("Trends (Google Trends-style interest)");
    else sourcesUnavailable.push("Trends (no tracked keyword for this niche)");
    if (input.hasSupplierData) sourcesAnalyzed.push("Supplier data (AliExpress-style seller counts)");
    else sourcesUnavailable.push("Supplier data (no tracked listings for this niche)");
  }

  const signals: CountryScoreSignals = {
    localAdvertiserCount: localAdvertisers.size,
    localActiveAds: input.localAds.length,
    recentLocalAdvertisers30d: recentLocalAdvertisers.size,
    globalAdvertiserCount: input.globalAdvertiserCount,
    localStoreCount: input.localStores.length,
    localStoreActiveAds: input.localStores.reduce((sum, s) => sum + s.activeAdsCount, 0),
    supplierSellerCount: input.avgSupplierSellers,
    trendInterest: input.trendCountryInterest,
    trendDirection: input.trendDirection,
    trendRisingPercent: input.trendRisingPercent,
    sourcesAnalyzed,
    sourcesUnavailable,
  };

  // ── Saturation Score (0-100, higher = more competitive) ──────────────────
  const weightedLocalAdvertiserVolume = input.localAds.reduce(
    (sum, a) => sum + recencyWeight(a.firstSeenAt, input.now),
    0
  );
  const metaSaturation = saturationCurve(weightedLocalAdvertiserVolume, 6);
  const storeSaturation = input.adsOnly ? null : saturationCurve(input.localStores.length, 5);
  const supplierSaturation =
    input.avgSupplierSellers !== undefined ? saturationCurve(input.avgSupplierSellers, 40) : null;

  const saturationScore = clamp(
    weightedAverage([
      { name: "Meta/TikTok advertiser saturation", score: metaSaturation, weight: 0.5 },
      { name: "Local Shopify store competition", score: storeSaturation, weight: 0.3 },
      { name: "Supplier/marketplace seller saturation", score: supplierSaturation, weight: 0.2 },
    ]),
    0,
    100
  );

  // ── Demand Score (0-100, higher = more consumer interest) ────────────────
  const trendDemand = input.trendCountryInterest ?? null;
  const totalViews = input.localAds.reduce((sum, a) => sum + parseCompactNumber(a.views), 0);
  const viewsDemand =
    totalViews > 0 ? saturationCurve(totalViews / 100_000, 8) : input.localAds.length > 0 ? 20 : null;
  const risingBonus =
    input.trendDirection === "Rising" ? clamp(Math.round((input.trendRisingPercent ?? 0) / 4), 0, 30) : 0;

  const demandScore = clamp(
    weightedAverage([
      { name: "Google Trends interest", score: trendDemand, weight: 0.55 },
      { name: "Ad engagement volume", score: viewsDemand, weight: 0.45 },
    ]) + risingBonus,
    0,
    100
  );

  const opportunityScore = computeOpportunityScore(demandScore, saturationScore);

  // ── Confidence: how much of our own data actually backed this check ──────
  const confidenceScore = input.adsOnly
    ? clamp(Math.round((input.localAds.length / 30) * 100), 5, 100) // 30+ local ads = full confidence
    : clamp(Math.round((sourcesAnalyzed.length / (sourcesAnalyzed.length + sourcesUnavailable.length)) * 100), 0, 100);

  return { saturationScore, demandScore, opportunityScore, confidenceScore, signals };
}
