// Salla billing for the COD confirm app: which plan a store is on (from the verified
// app.subscription.* / app.trial.* webhooks) and how many COD orders a month it may send
// for confirmation. Salla bills the merchant; we only read the events and gate.

export type Tier = "confirm" | "pro" | "bundle" | "trial";

/** Confirmations a month per tier; null = no limit. The trial gets the Pro allowance. */
export const TIER_LIMITS: Record<Tier, number | null> = { confirm: 500, pro: 3000, bundle: null, trial: 3000 };

/** After end_date we keep sending this long, so a renewal that lands a little late doesn't stop orders. */
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type PlanEvent = {
  kind: "start" | "end";
  trial: boolean;
  subscriptionId?: string;
  tier: Tier;
  planName?: string;
  endsAt?: number;
  storeType: string;
};

/**
 * Monthly price → tier. Our plans are 49 / 99 / 199 SAR a month (yearly ones are cheaper per
 * month), so the bands sit between them. Salla's payload has the price and the period in months,
 * not our plan's id.
 */
export function tierFor(price: number, periodMonths: number): Exclude<Tier, "trial"> {
  const monthly = price / (periodMonths > 0 ? periodMonths : 1);
  if (monthly >= 150) return "bundle";
  if (monthly >= 80) return "pro";
  return "confirm";
}

/** "2026-11-24" (or "2026-11-24 12:00:00") → the end of that day in Riyadh, in ms. */
export function sallaDate(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const d = /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1];
  if (!d) return undefined;
  const ms = Date.parse(`${d}T23:59:59+03:00`);
  return Number.isFinite(ms) ? ms : undefined;
}

const START = ["app.subscription.started", "app.subscription.renewed", "app.trial.started"];
const END = ["app.subscription.expired", "app.subscription.canceled", "app.trial.expired", "app.trial.canceled"];

/** A plan event from a subscription/trial webhook; null for anything else, addons included. */
export function planEventFrom(event: string, data: Record<string, unknown>): PlanEvent | null {
  const start = START.includes(event);
  if (!start && !END.includes(event)) return null;
  if (data.item_type !== undefined && data.item_type !== "plan") return null;
  const trial = event.startsWith("app.trial.");
  const id = data.subscription_id;
  const price = Number(data.price);
  const period = Number(data.plan_period);
  return {
    kind: start ? "start" : "end",
    trial,
    subscriptionId: typeof id === "number" || typeof id === "string" ? String(id) : undefined,
    tier: trial ? "trial" : tierFor(Number.isFinite(price) ? price : 0, Number.isFinite(period) ? period : 1),
    planName: typeof data.plan_name === "string" ? data.plan_name : undefined,
    endsAt: sallaDate(data.end_date) ?? sallaDate(data.renew_date),
    storeType: typeof data.store_type === "string" ? data.store_type : "live",
  };
}

export type StoredPlan = { tier: Tier; status: "active" | "trial" | "inactive"; endsAt?: number; storeType: string };

/**
 * What a store may send now. No plan on record (installed before billing, or a demo/development
 * store) isn't limited; Salla's own test stores never are.
 */
export function planGate(plan: StoredPlan | null, now: number): { limited: boolean; active: boolean; limit: number | null } {
  if (!plan || plan.storeType !== "live") return { limited: false, active: true, limit: null };
  const active = plan.status !== "inactive" && (plan.endsAt == null || now <= plan.endsAt + GRACE_MS);
  return { limited: true, active, limit: TIER_LIMITS[plan.tier] };
}

/** Usage is counted per calendar month in Riyadh time: "2026-10". */
export function usageMonth(ms: number): string {
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
