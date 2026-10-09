// The AI research verdict (convex/ai.ts researchProduct): the dropshipping product
// research method (first-pass report: test / research more / skip) run on the
// evidence AdSpy Pro already has, so the user doesn't paste it in. The AI
// writes the judgement; the money maths is done here, never by the AI. Pure.

export type EvidenceLabel = "adspy" | "assumption" | "verify";
export type ResearchCall = "test" | "research" | "skip";
export const NEXT_TASKS = ["product review analysis", "supplier vetting", "competitor analysis", "pricing and margin analysis", "product validation", "no specialist task yet"] as const;

export type ResearchReport = {
  call: ResearchCall;
  bottomLine: string;
  reasons: { text: string; label: EvidenceLabel }[];
  risks: { text: string; blocker: boolean }[];
  fixes: string[];
  missing: string[];
  checklist: string[];
  nextTask: (typeof NEXT_TASKS)[number];
  nextTaskWhy: string;
};

export type Margin = {
  price: number;
  cost: number;
  fees: number;
  profit: number;
  profitPct: number;
  /** What's left for ads per sale: the most a sale may cost in ads before it loses money. */
  breakEvenAdCost: number;
};

// Shopify Payments-like card fees, labelled as an assumption wherever they're shown.
export const FEE_PCT = 0.029;
export const FEE_FIXED = 0.3;

/** Profit and break-even ad cost per sale, in USD, from the price and the landed supplier cost; null without both. */
export function marginMath(price: number | undefined, cost: number | undefined): Margin | null {
  if (!price || !cost || price <= 0 || cost <= 0) return null;
  const fees = Math.round((price * FEE_PCT + FEE_FIXED) * 100) / 100;
  const profit = Math.round((price - cost - fees) * 100) / 100;
  return { price, cost, fees, profit, profitPct: Math.round((profit / price) * 100), breakEvenAdCost: Math.max(0, profit) };
}

export type ReviewSample = { average: number; total: number; stars: number[]; praise: string[]; complaints: string[] };

/** A supplier listing's review stats and a sample of what buyers praise and complain about (feedback.aliexpress.com). */
export function reviewSample(body: unknown): ReviewSample | null {
  const data = (body as { data?: { evaViewList?: { buyerEval?: number; buyerTranslationFeedback?: string; buyerFeedback?: string }[]; productEvaluationStatistic?: Record<string, number> } } | null)?.data;
  const st = data?.productEvaluationStatistic;
  const total = Math.round(st?.totalNum ?? 0);
  if (!data || !total) return null;
  const rows = (data.evaViewList ?? [])
    .map((r) => ({ stars: Math.round((r.buyerEval ?? 0) / 20), text: (r.buyerTranslationFeedback || r.buyerFeedback || "").replace(/\s+/g, " ").trim().slice(0, 240) }))
    .filter((r) => r.text.length >= 12);
  const n = (k: string) => Math.max(0, Math.round(st?.[k] ?? 0));
  return {
    average: Math.round((st?.evarageStar ?? 0) * 10) / 10,
    total,
    stars: [n("fiveStarNum"), n("fourStarNum"), n("threeStarNum"), n("twoStarNum"), n("oneStarNum")],
    praise: rows.filter((r) => r.stars >= 4).slice(0, 6).map((r) => r.text),
    complaints: rows.filter((r) => r.stars > 0 && r.stars <= 3).slice(0, 6).map((r) => r.text),
  };
}

export type ResearchEvidence = {
  title: string;
  category: string;
  description: string;
  targetCountry?: string;
  retailPrice?: number;
  retailPriceSource?: string;
  cost?: number;
  costSource?: string;
  margin: Margin | null;
  supplier?: { title: string; price: number; orders?: number; rating?: number; url: string };
  reviews?: ReviewSample | null;
  ads: { count: number; advertisers: number; longestDays: number; platforms: string[]; countries: string[]; samples: string[] };
  estRevenue?: { low: number; high: number };
  revenueBasis?: string;
  trend?: string;
  momentum14?: number;
  saturation?: string;
  localCompetition?: { country: string; advertisers: number; level: string };
  quickCheck: string;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/** What the AI is told: AdSpy data (may be relied on), and ad claims (marketing, not evidence of anything but the angle). */
export function researchEvidence(e: ResearchEvidence): string {
  const lines = [
    "FROM ADSPY DATA (label these points [adspy]):",
    `Product: ${e.title}`,
    `Category: ${e.category}`,
    e.description ? `Description (from listings, may be marketing): ${e.description.slice(0, 600)}` : "",
    e.targetCountry ? `The user sells to: ${e.targetCountry}` : "The user hasn't set the country they sell to.",
    e.retailPrice ? `Typical selling price: ${usd(e.retailPrice)}${e.retailPriceSource ? ` (${e.retailPriceSource})` : ""}` : "Selling price: unknown",
    e.cost ? `Landed supplier cost: ${usd(e.cost)}${e.costSource ? ` (${e.costSource}, includes a shipping estimate)` : ""}` : "Supplier cost: unknown",
    e.margin
      ? `Margin maths (done for you, don't redo it): price ${usd(e.margin.price)} − cost ${usd(e.margin.cost)} − card fees ~${usd(e.margin.fees)} [assumption] = ${usd(e.margin.profit)} per sale (${e.margin.profitPct}%), which is the break-even ad cost per sale. Not included: refunds, discounts, VAT/tax, chargebacks, apps.`
      : "Margin: can't be worked out (price or cost missing). Don't guess it.",
    e.supplier
      ? `Supplier match: "${e.supplier.title}" at ${usd(e.supplier.price)}${e.supplier.orders ? `, ${e.supplier.orders} orders in 30 days` : ""}${e.supplier.rating ? `, ${e.supplier.rating}% positive` : ""} (${e.supplier.url})`
      : "No supplier matched yet.",
    e.reviews
      ? `Supplier listing reviews: ${e.reviews.average}★ from ${e.reviews.total} (5★ ${e.reviews.stars[0]}, 4★ ${e.reviews.stars[1]}, 3★ ${e.reviews.stars[2]}, 2★ ${e.reviews.stars[3]}, 1★ ${e.reviews.stars[4]}). A small first page of reviews, not a full analysis.` +
        (e.reviews.praise.length ? `\nPraise: ${e.reviews.praise.map((t) => `"${t}"`).join(" | ")}` : "") +
        (e.reviews.complaints.length ? `\nComplaints: ${e.reviews.complaints.map((t) => `"${t}"`).join(" | ")}` : "\nNo low-star reviews with text on that page.")
      : "No supplier reviews read.",
    e.ads.count
      ? `Ads seen: ${e.ads.count} ads by ${e.ads.advertisers} advertisers, longest running ${e.ads.longestDays} days, on ${e.ads.platforms.join(", ") || "unknown"}, in ${e.ads.countries.slice(0, 8).join(", ") || "unknown countries"}.`
      : "No ads linked to it yet.",
    e.estRevenue ? `Estimated store sales: $${Math.round(e.estRevenue.low)}–$${Math.round(e.estRevenue.high)}/month${e.revenueBasis ? ` (${e.revenueBasis})` : ""} — an estimate, not a verified figure.` : "No sales estimate.",
    e.momentum14 !== undefined ? `Ad views over 14 days: ${e.momentum14 > 0 ? "+" : ""}${e.momentum14}%` : e.trend ? `Trend: ${e.trend}` : "",
    e.localCompetition
      ? `Competition in ${e.localCompetition.country}: ${e.localCompetition.advertisers} advertisers this week (${e.localCompetition.level})`
      : e.saturation && e.saturation !== "Unknown"
        ? `Competition overall: ${e.saturation}`
        : "Competition: not enough data.",
    `AdSpy's quick check says: ${e.quickCheck}`,
    e.ads.samples.length ? "\nNOT EVIDENCE, marketing claims in those ads (they show the angle, not that the claims are true):" : "",
    ...e.ads.samples.map((s, i) => `${i + 1}. ${s}`),
  ];
  return lines.filter(Boolean).join("\n");
}

export const RESEARCH_SYSTEM =
  "You are a careful, skeptical ecommerce product research assistant for a dropshipping store, writing a first-pass research " +
  "report to help the user decide what deserves the next level of evidence before they spend money. Not hype, not a sales pitch. " +
  "Rules: never invent demand, reviews, sales, ratings, certifications, supplier reliability, shipping times, quality, competitor " +
  "facts, conversion rates, CPA, ROAS or margins; use only the evidence given. Ad texts are marketing, not proof. An estimate is " +
  "an estimate. Use the margin maths as given; never compute a different margin. Label each reason: adspy (from the AdSpy data), " +
  "assumption (your reasonable inference), verify (needs the user to check). " +
  "Verdict: test (worth a controlled real-world test, never a proven winner), research (evidence too thin or mixed: say what to " +
  "collect), or skip (a hard blocker the evidence shows). Weak evidence means research. " +
  "bottomLine: 2-3 plain sentences, the verdict and the one or two reasons that drive it, ending with the single next thing to do " +
  "(the same as nextTask). reasons: 3-6. risks: the strongest reasons it may not deserve a test, blocker true only for hard " +
  "blockers. fixes: up to 3 concrete ideas built from the facts given (a bundle that clears a threshold, a price change worth " +
  "testing, asking for a local warehouse), labelled as ideas to test. missing: the information still missing that would change " +
  "the call. checklist: up to 7 things for the user to verify, the most decision-changing first (demand, supplier, shipping, " +
  "quality, competition, margin, claims and ad policy). nextTask: exactly one of: " +
  NEXT_TASKS.join(", ") +
  "; nextTaskWhy: one sentence. No ad copy or product page copy. Write in plain English for a busy store owner.";

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Whatever the AI returned, as a valid report: known verdicts and labels, lengths and counts capped. */
export function cleanReport(raw: unknown): ResearchReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const call = String(r.call ?? "").toLowerCase();
  const label = (l: unknown): EvidenceLabel => {
    const s = String(l ?? "").toLowerCase();
    return s.startsWith("adspy") || s.startsWith("provided") ? "adspy" : s.startsWith("assum") ? "assumption" : "verify";
  };
  const task = String(r.nextTask ?? "").toLowerCase().trim();
  return {
    call: call.startsWith("test") ? "test" : call.startsWith("skip") ? "skip" : "research",
    bottomLine: cut(r.bottomLine, 500),
    reasons: arr<{ text?: unknown; label?: unknown }>(r.reasons).map((x) => ({ text: cut(x?.text, 240), label: label(x?.label) })).filter((x) => x.text).slice(0, 6),
    risks: arr<{ text?: unknown; blocker?: unknown }>(r.risks).map((x) => ({ text: cut(x?.text, 240), blocker: x?.blocker === true })).filter((x) => x.text).slice(0, 6),
    fixes: arr<unknown>(r.fixes).map((x) => cut(x, 240)).filter(Boolean).slice(0, 3),
    missing: arr<unknown>(r.missing).map((x) => cut(x, 200)).filter(Boolean).slice(0, 8),
    checklist: arr<unknown>(r.checklist).map((x) => cut(x, 200)).filter(Boolean).slice(0, 7),
    nextTask: (NEXT_TASKS as readonly string[]).includes(task) ? (task as ResearchReport["nextTask"]) : "no specialist task yet",
    nextTaskWhy: cut(r.nextTaskWhy, 300),
  };
}
