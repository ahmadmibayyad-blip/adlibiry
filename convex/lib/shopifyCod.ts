// Istilam for Shopify, pure parts: which orders are cash on delivery, the customer's WhatsApp
// number from an order, and the app's plans (Shopify Billing API, convex/shopifyCodEmbedded.ts).

import { GRACE_MS, TIER_LIMITS, type Tier } from "./codPlans";

const COD_GATEWAY = /cash on delivery|\bcod\b|الدفع عند الاستلام/i;

/** A new order the customer pays on delivery: a COD gateway and nothing paid yet. */
export function isCodOrder(o: { payment_gateway_names?: unknown; financial_status?: unknown }): boolean {
  const names = Array.isArray(o.payment_gateway_names) ? o.payment_gateway_names : [];
  return o.financial_status === "pending" && names.some((n) => typeof n === "string" && COD_GATEWAY.test(n));
}

export type ShopifyCodOrder = { orderId: string; orderName: string; total?: number; currency?: string };

/** The orders/create webhook body as a COD order to confirm; null when it isn't one. */
export function codOrderFromWebhook(body: Record<string, unknown>): ShopifyCodOrder | null {
  if (!isCodOrder(body)) return null;
  const id = body.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const orderId = String(id);
  if (!/^\d+$/.test(orderId)) return null;
  const total = Number(body.total_price);
  return {
    orderId,
    orderName: typeof body.name === "string" && body.name ? body.name : `#${body.order_number ?? orderId}`,
    total: Number.isFinite(total) ? total : undefined,
    currency: typeof body.currency === "string" ? body.currency : undefined,
  };
}

/** Calling codes of the countries Istilam's merchants sell to most; a local number elsewhere needs its "+". */
export const DIAL_CODES: Record<string, string> = {
  SA: "966", AE: "971", KW: "965", QA: "974", BH: "973", OM: "968", EG: "20", JO: "962", MA: "212", DZ: "213",
  TN: "216", IQ: "964", LB: "961", LY: "218", YE: "967", PS: "970", SY: "963", SD: "249", TR: "90",
  DK: "45", SE: "46", NO: "47", DE: "49", NL: "31", BE: "32", FR: "33", GB: "44", IE: "353", ES: "34", IT: "39",
  US: "1", CA: "1",
};

/** WhatsApp's digits-only form of a Shopify phone: "+"/"00" numbers as given, local ones with the country's code. */
export function waNumberFrom(phone: unknown, countryCode: unknown): string | null {
  if (typeof phone !== "string" && typeof phone !== "number") return null;
  const raw = String(phone).trim();
  let num: string;
  if (/^(\+|00)/.test(raw)) {
    num = raw.replace(/\D/g, "").replace(/^00/, "");
  } else {
    const code = typeof countryCode === "string" ? DIAL_CODES[countryCode.toUpperCase()] : undefined;
    const local = raw.replace(/\D/g, "");
    if (!code || !local) return null;
    num = local.startsWith(code) && local.length > code.length + 7 ? local : code + local.replace(/^0+/, "");
  }
  return num.length >= 9 && num.length <= 15 ? num : null;
}

type Address = { phone?: string | null; countryCodeV2?: string | null } | null;
export type ShopifyPhoneOrder = {
  shippingAddress?: Address;
  billingAddress?: Address;
  customer?: { defaultPhoneNumber?: { phoneNumber?: string | null } | null } | null;
};

/** The number to message: shipping, then billing, then the customer's own (with the shipping country, else billing). */
export function pickPhone(o: ShopifyPhoneOrder): string | null {
  const country = o.shippingAddress?.countryCodeV2 ?? o.billingAddress?.countryCodeV2;
  return (
    waNumberFrom(o.shippingAddress?.phone, o.shippingAddress?.countryCodeV2) ??
    waNumberFrom(o.billingAddress?.phone, o.billingAddress?.countryCodeV2) ??
    waNumberFrom(o.customer?.defaultPhoneNumber?.phoneNumber, country)
  );
}

export type ShopifyPlan = { name: string; amount: number; interval: "EVERY_30_DAYS" | "ANNUAL"; tier: Exclude<Tier, "trial"> };

/** USD prices; the names are what Shopify shows the merchant and what we read the tier from. */
export const SHOPIFY_PLANS: readonly ShopifyPlan[] = [
  { name: "Confirm", amount: 13, interval: "EVERY_30_DAYS", tier: "confirm" },
  { name: "Confirm Pro", amount: 27, interval: "EVERY_30_DAYS", tier: "pro" },
  { name: "Confirm Unlimited", amount: 53, interval: "EVERY_30_DAYS", tier: "bundle" },
  { name: "Confirm Pro Yearly", amount: 264, interval: "ANNUAL", tier: "pro" },
];
export const TRIAL_DAYS = 7;

export function tierForPlanName(name: string): Exclude<Tier, "trial"> | null {
  return SHOPIFY_PLANS.find((p) => p.name === name)?.tier ?? null;
}

export type ShopPlan = { tier: Tier; status: string; currentPeriodEnd?: number };

/** Sending needs an active subscription (trial included); unlike Salla, no plan means nothing is sent. */
export function shopGate(plan: ShopPlan | undefined, now: number): { active: boolean; limit: number | null } {
  if (!plan) return { active: false, limit: null };
  const active = plan.status === "ACTIVE" && (plan.currentPeriodEnd == null || now <= plan.currentPeriodEnd + GRACE_MS);
  return { active, limit: TIER_LIMITS[plan.tier] };
}
