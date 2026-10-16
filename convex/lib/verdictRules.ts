// Verdict rules: demand signals, hard blockers and a ceiling the AI's call can't go above. Pure.
import { bigBrandIn } from "./productMatch";
import type { Margin, ResearchCall } from "./researchReport";
import { withVat } from "./vat";

export const RULES_VERSION = 2;

export type SignalKey = "ads" | "supplier" | "adspy" | "tiktok" | "ownStore";

export type RuleInput = {
  margin: Margin | null;
  priceAssumed: boolean;
  vatRate: number | null;
  ads: { advertisers: number; longestDays: number };
  supplierOrders?: number;
  adspyDemandOk: boolean | null;
  tiktokUnits?: number;
  ownOrders?: number;
  brandText: string;
  shippingDays?: number;
};

export type Rules = {
  signals: { key: SignalKey; seen: boolean; detail: string }[];
  blockers: string[];
  ceiling: ResearchCall;
  costKnown: boolean;
  breakEven?: number;
  afterVat: boolean;
  cappedBy?: string;
};

const MIN_BREAK_EVEN = 8;
const MAX_SHIPPING_DAYS = 15;
const SIGNAL_COUNT = 5;
const ORDER: Record<ResearchCall, number> = { skip: 0, research: 1, test: 2 };

export function evaluateRules(i: RuleInput): Rules {
  const signals: Rules["signals"] = [
    {
      key: "ads",
      seen: i.ads.longestDays >= 30 && i.ads.advertisers >= 2,
      detail: `${i.ads.advertisers} advertisers, longest ad ${i.ads.longestDays} days`,
    },
    { key: "supplier", seen: (i.supplierOrders ?? 0) >= 1000, detail: `${i.supplierOrders ?? 0} supplier orders` },
    {
      key: "adspy",
      seen: i.adspyDemandOk === true,
      detail: i.adspyDemandOk === null ? "no demand check" : i.adspyDemandOk ? "demand confirmed" : "demand not confirmed",
    },
    { key: "tiktok", seen: (i.tiktokUnits ?? 0) >= 1000, detail: `${i.tiktokUnits ?? 0} TikTok units` },
    { key: "ownStore", seen: (i.ownOrders ?? 0) >= 3, detail: `${i.ownOrders ?? 0} own-store orders` },
  ];
  const seenCount = signals.filter((s) => s.seen).length;

  const afterVat = !!i.margin && i.vatRate !== null;
  const costKnown = !!i.margin;
  let breakEven: number | undefined;
  if (i.margin) breakEven = i.vatRate !== null ? withVat(i.margin, i.vatRate).breakEvenAfterVat : i.margin.breakEvenAdCost;

  const blockers: string[] = [];
  if (i.margin && !i.priceAssumed && breakEven !== undefined && breakEven < MIN_BREAK_EVEN) {
    blockers.push(`Break-even ad cost under $${MIN_BREAK_EVEN}${afterVat ? " after VAT" : ""}`);
  }
  const brand = bigBrandIn(i.brandText);
  if (brand) blockers.push(`Famous brand: ${brand}`);
  if (i.shippingDays !== undefined && i.shippingDays > MAX_SHIPPING_DAYS) blockers.push(`Shipping over ${MAX_SHIPPING_DAYS} days`);

  let ceiling: ResearchCall = "test";
  let cappedBy: string | undefined;
  if (blockers.length) ceiling = "skip";
  else if (seenCount < 2) {
    ceiling = "research";
    cappedBy = `${seenCount} of ${SIGNAL_COUNT} demand signals`;
  } else if (!costKnown) {
    ceiling = "research";
    cappedBy = "supplier cost unknown";
  } else if (i.priceAssumed) {
    ceiling = "research";
    cappedBy = "price is a category estimate";
  }

  return { signals, blockers, ceiling, costKnown, breakEven, afterVat, cappedBy };
}

/** The lowest of the AI's call and the ceiling; an AI blocker makes it skip. cappedBy is set only when the ceiling lowered the call. */
export function finalCall(ai: ResearchCall, aiBlocker: boolean, rules: Rules): { call: ResearchCall; cappedBy?: string } {
  if (aiBlocker) return { call: "skip", cappedBy: undefined };
  if (ORDER[rules.ceiling] < ORDER[ai]) return { call: rules.ceiling, cappedBy: rules.cappedBy ?? rules.blockers[0] };
  return { call: ai, cappedBy: undefined };
}

export function whyLine(r: Rules, money: (usd: number) => string): string {
  const n = r.signals.filter((s) => s.seen).length;
  const parts = [`${n} of ${SIGNAL_COUNT} demand signals`];
  if (r.costKnown && r.breakEven !== undefined) {
    parts.push("cost known", `break-even ${money(r.breakEven)}${r.afterVat ? " after VAT" : ""}`);
  } else parts.push("cost unknown");
  return parts.join(" · ");
}
