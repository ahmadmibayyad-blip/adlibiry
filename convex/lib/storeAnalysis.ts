// AI store analysis (Store Inspector → "Analyze this store"): what a competitor's store does to sell,
// what to copy and how to beat it, from what AdSpy read (lib/storeInspect.ts, lib/storeTeardown.ts) and
// the store's ads AdSpy has. Pure: the prompt, the evidence text and the clean-up of the AI's answer.
// STORE_ANALYSIS_SYSTEM is also the prompt owners can paste into any AI with a store's facts.

import type { Inspection } from "./storeInspect";
import { offerTags } from "./offerTags";

export const STORE_ANALYSIS_SYSTEM = [
  "You are a senior e-commerce conversion strategist who has built and audited hundreds of one-product dropshipping stores that sell with Meta and TikTok ads.",
  "You get facts AdSpy read from a competitor's Shopify store and its ads: theme, apps, tracking pixels, the main product page (price, bundle tiers, review numbers shown, conversion features, section order) and the ads it runs (offer, how long they've run).",
  "Write a sharp, practical analysis for a store owner who wants to compete in the same market:",
  "- verdict: one sentence on how this store sells and how strong it is.",
  "- strengths: 3–6 things the store does that likely drive sales, each tied to a fact in the evidence (evidence: the fact, short).",
  "- copy: 3–6 concrete steps to copy what works, in order of impact (e.g. \"3 bundle tiers with the 2-pack preselected and badged\", \"a free-shipping bar in the cart\").",
  "- beat: 3–5 ways to beat this store (offer, page, trust, ad angle), specific and doable.",
  "- weaknesses: 2–5 gaps or friction points in their store.",
  "- warnings: claims or tactics that look misleading or risky (e.g. an \"ends today\" offer that has run for months, review numbers that can't be checked, fake scarcity). Say they shouldn't be copied. Empty if none.",
  "- missing: what AdSpy couldn't see that would change the analysis (e.g. reviews that load in the browser, the checkout).",
  "Rules: only use the evidence; never invent sales, revenue, traffic, conversion rates or review numbers. Say \"the page shows\" for numbers the store displays. Short, concrete sentences.",
].join("\n");

export type StoreAnalysis = {
  verdict: string;
  strengths: { point: string; evidence: string }[];
  copy: string[];
  beat: string[];
  weaknesses: string[];
  warnings: string[];
  missing: string[];
};

export type StoreAd = { headline: string; body: string; daysRunning: number; country?: string; isActive?: boolean };

const money = (n: number, currency?: string) => `${n.toFixed(2)}${currency ? ` ${currency}` : ""}`;

/** The facts the AI gets, as plain text. */
export function storeEvidence(host: string, r: Inspection, ads: StoreAd[] = []): string {
  const lines: string[] = [`Store: ${host}${r.shopName ? ` (${r.shopName})` : ""}`];
  if (!r.shopify) lines.push("Not a Shopify store (or Shopify couldn't be confirmed).");
  if (r.country || r.currency || r.locale) lines.push(`Market: ${[r.country, r.currency, r.locale].filter(Boolean).join(", ")}`);
  if (r.theme) lines.push(`Theme: ${r.theme.name}${r.theme.schemaName && r.theme.schemaName !== r.theme.name ? ` (based on ${r.theme.schemaName})` : ""}${r.theme.version ? ` v${r.theme.version}` : ""}${r.theme.free ? ", a free theme" : r.theme.vendor ? `, by ${r.theme.vendor}` : ""}`);
  lines.push(`Apps: ${r.apps.length ? r.apps.map((a) => `${a.name} (${a.category})`).join(", ") : "none seen"}`);
  lines.push(`Ad pixels: ${r.pixels.length ? r.pixels.join(", ") : "none seen"}`);
  const t = r.teardown;
  if (t) {
    lines.push("", `Main product page: ${t.productTitle ?? t.productPath}`);
    if (t.price) {
      lines.push(`Price: ${money(t.price.price, t.price.currency)}${t.price.compareAt ? `, compare-at ${money(t.price.compareAt, t.price.currency)} (${t.price.percentOff ?? "?"}% off shown)` : ", no compare-at price"}${t.price.variants && t.price.variants > 1 ? `, ${t.price.variants} variants` : ""}`);
    }
    if (t.reviews) lines.push(`Reviews the page shows: ${t.reviews.rating ?? "?"}★ from ${t.reviews.count ?? "?"} reviews${t.reviews.app ? ` (${t.reviews.app})` : ""}, read from the ${t.reviews.source}; not verified`);
    else lines.push("Reviews: none in the page's HTML (a review widget may load in the browser)");
    if (t.bundle?.tiers.length) {
      lines.push(`Bundle offer (${t.bundle.app}${t.bundle.heading ? `, "${t.bundle.heading}"` : ""}):`);
      for (const tier of t.bundle.tiers) {
        const deal =
          tier.deal.kind === "percent" ? `${tier.deal.value}% off` :
          tier.deal.kind === "price" ? `fixed price ${money(tier.deal.value, t.price?.currency)}` :
          tier.deal.kind === "amount" ? `${money(tier.deal.value, t.price?.currency)} off` :
          tier.deal.kind === "buyXgetY" ? `buy ${tier.deal.buy} get ${tier.deal.get}` :
          tier.deal.kind === "bundle" ? `${tier.deal.items}-product bundle` : "full price";
        lines.push(
          `- "${tier.title}"${tier.quantity ? `, ${tier.quantity} units` : ""}, ${deal}${tier.percentOff !== undefined ? ` (≈${tier.percentOff}% off by our math)` : ""}` +
            `${tier.badge ? `, badge "${tier.badge}"` : ""}${tier.preselected ? ", preselected" : ""}${tier.freeShipping ? ", free shipping" : ""}${tier.freeGifts.length ? `, free gift: ${tier.freeGifts.join(", ")}` : ""}`,
        );
      }
    } else lines.push("Bundle offer: none found in the page's HTML");
    if (t.features.length) lines.push(`Conversion features: ${t.features.map((f) => (f.evidence ? `${f.label} ("${f.evidence.slice(0, 80)}")` : f.label)).join("; ")}`);
    if (t.sections.length) lines.push(`Page sections, top to bottom: ${t.sections.map((s) => s.label).join(" → ")}`);
  } else lines.push("", "Product page: couldn't be read.");

  if (ads.length) {
    const active = ads.filter((a) => a.isActive !== false);
    const longest = Math.max(...ads.map((a) => a.daysRunning));
    const offers = new Map<string, number>();
    for (const a of ads) for (const o of new Set(offerTags(`${a.headline}\n${a.body}`).map((x) => x.label))) offers.set(o, (offers.get(o) ?? 0) + 1);
    lines.push("", `Ads AdSpy has for this store: ${ads.length} (${active.length} active), the longest running ${longest} days, countries: ${[...new Set(ads.map((a) => a.country).filter(Boolean))].join(", ") || "unknown"}`);
    if (offers.size) lines.push(`Offers in the ads: ${[...offers.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} (${n})`).join(", ")}`);
    for (const a of [...ads].sort((x, y) => y.daysRunning - x.daysRunning).slice(0, 5)) {
      lines.push(`- ${a.daysRunning} days: ${`${a.headline} — ${a.body}`.replace(/\s+/g, " ").slice(0, 220)}`);
    }
  } else lines.push("", "Ads: AdSpy has none for this store yet.");
  return lines.join("\n");
}

const cut = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v : []).map((x) => cut(x, n)).filter(Boolean).slice(0, max);

/** Lengths and counts on the AI's answer. */
export function cleanAnalysis(raw: unknown): StoreAnalysis {
  const r = (raw ?? {}) as Partial<Record<keyof StoreAnalysis, unknown>>;
  return {
    verdict: cut(r.verdict, 300),
    strengths: (Array.isArray(r.strengths) ? r.strengths : [])
      .map((s: { point?: unknown; evidence?: unknown }) => ({ point: cut(s?.point, 200), evidence: cut(s?.evidence, 160) }))
      .filter((s) => s.point)
      .slice(0, 6),
    copy: list(r.copy, 6, 220),
    beat: list(r.beat, 5, 220),
    weaknesses: list(r.weaknesses, 5, 200),
    warnings: list(r.warnings, 4, 220),
    missing: list(r.missing, 4, 160),
  };
}

/** The analysis as text, to copy or share. */
export function analysisText(host: string, a: StoreAnalysis): string {
  const section = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((x) => `- ${x}`), ""] : []);
  return [
    `${host}: ${a.verdict}`,
    "",
    ...section("What they do well", a.strengths.map((s) => `${s.point}${s.evidence ? ` (${s.evidence})` : ""}`)),
    ...section("Copy this", a.copy),
    ...section("How to beat them", a.beat),
    ...section("Their weak spots", a.weaknesses),
    ...section("Don't copy", a.warnings),
    ...section("AdSpy couldn't see", a.missing),
  ].join("\n").trim();
}
