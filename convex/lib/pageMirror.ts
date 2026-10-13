// Mirror a page (Launch → "Copy a page's layout"): a competitor's product page, read by Store Teardown
// (lib/storeTeardown.ts), turned into a plan for our product page. We copy its structure: the order of
// its sections, its bundle offer (quantities, % off, which deal is preselected and badged) and buy-box
// features (sticky add-to-cart, delivery estimate, guarantee). Never its text, photos, reviews or brand:
// the AI writes the copy for the user's own product. Fake urgency (countdowns, "ends today") isn't copied.
// The themes (storeKit.ts productTemplate, dawnTheme.ts dawnProductTemplate) read the plan. Pure.

import type { BundleTier, PageSection, Teardown } from "./storeTeardown";

/** Below the buy box: one image-with-text row, the comparison table, reviews, the guarantee section or the FAQ. */
export type MirrorSection = "row" | "comparison" | "reviews" | "guarantee" | "faq";

/** One bundle deal: items in it and % off. */
export type MirrorTier = { qty: number; off: number };

export type PageMirror = {
  url: string;
  host: string;
  /** Their bundle deals, when we could read them; else ours (lib/storeKit.ts BUNDLE_OFF). */
  tiers?: MirrorTier[];
  /** 1-based: the deal chosen when the page opens. */
  preselect?: number;
  /** 1-based deals that carry a badge ("Most popular"). */
  badges?: number[];
  /** Sections under the buy box, top to bottom. */
  sections: MirrorSection[];
  sticky: boolean;
  delivery: boolean;
  guarantee: boolean;
  /** What was copied, and what wasn't and why: shown to the user after the launch. */
  copied: string[];
  skipped: string[];
};

/** Our own layout, used when a page's sections can't be read. */
export const DEFAULT_SECTIONS: MirrorSection[] = ["row", "comparison", "row", "row", "reviews", "guarantee", "faq"];
const MAX_ROWS = 3;

const SECTION_KIND: [RegExp, MirrorSection][] = [
  [/^(Image with text|Benefits \/ icons|Slideshow \/ gallery|Stats \/ results|Video|Banner|Text)\b/, "row"],
  [/^Comparison/, "comparison"],
  [/^(Testimonials|Reviews)/, "reviews"],
  [/^Guarantee/, "guarantee"],
  [/^FAQ/, "faq"],
];

const SECTION_NAMES: Record<MirrorSection, string> = {
  row: "Photo + text",
  comparison: "Comparison table",
  reviews: "Reviews",
  guarantee: "Guarantee",
  faq: "FAQ",
};

/** The page's sections under its buy box as our kinds: rows up to 3, the others once each. */
export function mirrorSections(sections: PageSection[]): MirrorSection[] {
  const buyBox = sections.findIndex((s) => s.label === "Buy box");
  const out: MirrorSection[] = [];
  for (const s of sections.slice(buyBox + 1)) {
    const kind = SECTION_KIND.find(([re]) => re.test(s.label))?.[1];
    if (!kind) continue;
    if (kind === "row" ? out.filter((k) => k === "row").length >= MAX_ROWS : out.includes(kind)) continue;
    out.push(kind);
  }
  return out;
}

/** A deal's % off, when it's a deal on more of the same product. */
function tierOff(t: BundleTier): number | undefined {
  switch (t.deal.kind) {
    case "none":
      return 0;
    case "percent":
      return t.deal.value;
    case "buyXgetY":
      return t.deal.buy + t.deal.get > 0 ? (t.deal.get / (t.deal.buy + t.deal.get)) * 100 : undefined;
    case "price":
    case "amount":
      return t.percentOff;
    default:
      return undefined;
  }
}

function tierQty(t: BundleTier, i: number): number {
  if (t.quantity) return t.quantity;
  return t.deal.kind === "buyXgetY" ? t.deal.buy + t.deal.get : i + 1;
}

/** Their deals as quantities and % off the themes and Shopify's automatic discounts can do: 2–3 deals, 1–10 items, up to 70% off. */
export function mirrorTiers(tiers: BundleTier[]): { tiers: MirrorTier[]; preselect: number; badges: number[] } | null {
  if (tiers.some((t) => t.deal.kind === "bundle")) return null;
  const kept: { tier: BundleTier; qty: number; off: number }[] = [];
  tiers.forEach((t, i) => {
    const off = tierOff(t);
    const qty = tierQty(t, i);
    if (off === undefined || !Number.isInteger(qty) || qty < 1 || qty > 10) return;
    if (kept.length && qty <= kept[kept.length - 1].qty) return;
    kept.push({ tier: t, qty, off: Math.min(70, Math.max(0, Math.round(off))) });
  });
  const list = kept.slice(0, 3);
  if (list.length < 2 || !list.some((t) => t.off > 0)) return null;
  const chosen = list.findIndex((t) => t.tier.preselected);
  const badges = list.flatMap((t, i) => (t.tier.badge ? [i + 1] : []));
  return {
    tiers: list.map(({ qty, off }) => ({ qty, off })),
    preselect: chosen >= 0 ? chosen + 1 : badges[0] ?? Math.min(2, list.length),
    badges: badges.slice(0, 2),
  };
}

const has = (t: Teardown, key: string) => t.features.some((f) => f.key === key);

/** The plan for our page from their teardown; null teardown (the page couldn't be read) gives our own layout. */
export function mirrorPlan(url: string, t: Teardown | null): PageMirror {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  const base = { url, host, sticky: true, delivery: true, guarantee: true };
  if (!t) {
    return { ...base, sections: DEFAULT_SECTIONS, copied: [], skipped: [`We couldn't read ${host}'s product page, so the store uses our own layout.`] };
  }
  const copied: string[] = [];
  const skipped: string[] = [];

  // Bundle deals.
  const deals = t.bundle?.tiers.length ? mirrorTiers(t.bundle.tiers) : null;
  if (deals) {
    const list = deals.tiers.map((x) => `${x.qty} ${x.qty === 1 ? "item" : "items"}${x.off ? ` −${x.off}%` : ""}`).join(", ");
    copied.push(`Bundle deals: ${list}, deal ${deals.preselect} chosen first${deals.badges.length ? `, badge on deal ${deals.badges.join(" and ")}` : ""}`);
    if (t.bundle?.tiers.some((x) => x.freeGifts.length)) skipped.push("Free gifts in their deals: add your own gift in the theme editor (Bundle deals → Free gift) if you have one.");
  } else if (t.bundle?.tiers.length) {
    skipped.push(`Their bundle offer (${t.bundle.app}) can't be made with quantity discounts, so the store uses ours: 1, 2 or 3 items.`);
  } else {
    skipped.push("No bundle offer found on their page (some apps only load in the browser), so the store uses ours: 1, 2 or 3 items.");
  }

  // Sections under the buy box.
  let sections = mirrorSections(t.sections);
  const unread = sections.length < 2;
  if (unread) {
    sections = DEFAULT_SECTIONS;
    skipped.push("Their section layout couldn't be read (a page builder or custom sections), so the sections follow our proven order.");
  } else {
    if (has(t, "comparison") && !sections.includes("comparison")) sections.splice(Math.min(1, sections.length), 0, "comparison");
    if (has(t, "faq") && !sections.includes("faq")) sections.push("faq");
    copied.push(`Section order: ${sections.map((s) => SECTION_NAMES[s]).join(" → ")}`);
    if (!sections.includes("reviews")) {
      // Review widgets often load only in the browser; reviews are the one section we always keep.
      const at = sections[sections.length - 1] === "faq" ? sections.length - 1 : sections.length;
      sections.splice(at, 0, "reviews");
      skipped.push("No reviews section found on their page (review apps often load in the browser), so a reviews section was added at the end.");
    }
  }

  // An unreadable page keeps our buy-box extras too.
  const sticky = unread || has(t, "sticky_atc");
  const delivery = unread || has(t, "delivery_date");
  const guarantee = unread || has(t, "guarantee");
  const buyBox = [sticky && "sticky add-to-cart bar", delivery && "delivery estimate", guarantee && "money-back guarantee"].filter(Boolean);
  if (buyBox.length && !unread) copied.push(`In the buy box: ${buyBox.join(", ")}`);
  if (has(t, "countdown") || has(t, "ends_today")) skipped.push("Countdown timer / “ends today” text: not copied. Offers that never end break Meta's ad rules and EU consumer law.");
  if (has(t, "live_viewers")) skipped.push("“People viewing now” counter: not copied, it's usually fake.");
  if (has(t, "customer_claim")) skipped.push("Their customer-count claim: not copied. Only use numbers you can prove.");
  return { ...base, sticky, delivery, guarantee, ...(deals ?? {}), sections, copied, skipped };
}
