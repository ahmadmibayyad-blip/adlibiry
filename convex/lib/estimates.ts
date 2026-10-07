// Estimated impressions, ad spend and revenue for a product, the way ad-spy
// tools (Minea, WinningHunter) model them: reported numbers when a source has
// them, otherwise rules of thumb, always as a low–high range and labelled as
// an estimate. Spend = impressions ÷ 1,000 × CPM. Revenue = sales from the
// marketplace's own counts, or impressions × click rate × conversion × price.
// These are directional (often 2× off either way): for ranking and comparing.

export type EstimateInput = {
  price?: number;
  views?: number;     // reported impressions/views of linked ads
  likes?: number;
  comments?: number;
  spend?: number;     // reported (upper) ad spend of linked ads, USD
  gmv?: number;       // reported sales (TikTok Shop GMV), USD
  unitsPerMonth?: number; // orders/month from the marketplace's own data
};

export type Range = { low: number; high: number };
export type Estimates = {
  impressions?: Range;
  impressionsBasis?: "reported" | "engagement" | "spend";
  adSpend?: Range;
  adSpendBasis?: "reported" | "impressions";
  revenue?: Range; // per month, USD
  revenueBasis?: "reported_gmv" | "marketplace_sales" | "ad_funnel";
};

// Rules of thumb (e-commerce averages for Meta/TikTok ads).
export const ASSUMPTIONS = {
  engagementRate: { low: 0.01, high: 0.03 }, // likes+comments per impression
  cpm: { low: 6, high: 15 },                 // USD per 1,000 impressions
  clickRate: { low: 0.008, high: 0.015 },
  conversion: { low: 0.01, high: 0.03 },
  monthsOfImpressions: 2,                    // reported views ≈ 2 months of delivery
};

const pos = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (r: Range): Range => ({ low: Math.round(r.low), high: Math.round(r.high) });

export function estimateProduct(i: EstimateInput): Estimates {
  const out: Estimates = {};
  const A = ASSUMPTIONS;

  // Impressions
  if (pos(i.views)) {
    out.impressions = { low: i.views, high: i.views };
    out.impressionsBasis = "reported";
  } else if (pos(i.spend)) {
    out.impressions = round({ low: (i.spend / A.cpm.high) * 1000, high: (i.spend / A.cpm.low) * 1000 });
    out.impressionsBasis = "spend";
  } else if (pos((i.likes ?? 0) + (i.comments ?? 0))) {
    const eng = (i.likes ?? 0) + (i.comments ?? 0);
    out.impressions = round({ low: eng / A.engagementRate.high, high: eng / A.engagementRate.low });
    out.impressionsBasis = "engagement";
  }

  // Ad spend
  if (pos(i.spend)) {
    out.adSpend = { low: Math.round(i.spend / 3), high: Math.round(i.spend) };
    out.adSpendBasis = "reported";
  } else if (out.impressions) {
    out.adSpend = round({ low: (out.impressions.low / 1000) * A.cpm.low, high: (out.impressions.high / 1000) * A.cpm.high });
    out.adSpendBasis = "impressions";
  }

  // Revenue per month
  if (pos(i.unitsPerMonth) && pos(i.price)) {
    const r = i.unitsPerMonth * i.price;
    out.revenue = round({ low: r * 0.7, high: r * 1.3 });
    out.revenueBasis = "marketplace_sales";
  } else if (pos(i.gmv)) {
    out.revenue = round({ low: i.gmv / 3, high: i.gmv }); // GMV is a running total; a month is a share of it
    out.revenueBasis = "reported_gmv";
  } else if (out.impressions && pos(i.price)) {
    const perMonth = (n: number) => n / (out.impressionsBasis === "reported" ? A.monthsOfImpressions : 1);
    out.revenue = round({
      low: perMonth(out.impressions.low) * A.clickRate.low * A.conversion.low * i.price,
      high: perMonth(out.impressions.high) * A.clickRate.high * A.conversion.high * i.price,
    });
    out.revenueBasis = "ad_funnel";
  }
  return out;
}

// Orders per month from a discovered product's description text
// ("320 orders last week (est.)", "1,200 sold in the latest day").
export function unitsPerMonthFromText(text: string): number | undefined {
  const week = text.match(/([\d,]+)\s+orders last week/i);
  if (week) return Math.round(Number(week[1].replace(/,/g, "")) * 4.3);
  const day = text.match(/([\d,]+)\s+sold in the latest day/i);
  if (day) return Math.round(Number(day[1].replace(/,/g, "")) * 30);
  return undefined;
}

// ── One number instead of a range ───────────────────────────────────────────
// The app shows a single estimate (the geometric middle of the range) with a
// confidence label from how it was worked out, rather than a wide range.

export type Confidence = "High" | "Medium" | "Low";

export function pointEstimate(r: Range | undefined): number | undefined {
  if (!r || !(r.high > 0)) return undefined;
  return Math.round(Math.sqrt(Math.max(r.low, 1) * r.high));
}

// Marketplace order counts are close to real sales; reported GMV is a running
// total; the ad funnel is rules of thumb.
export function revenueConfidence(basis: string | undefined): Confidence | undefined {
  return basis === "marketplace_sales" ? "High" : basis === "reported_gmv" ? "Medium" : basis === "ad_funnel" ? "Low" : undefined;
}
