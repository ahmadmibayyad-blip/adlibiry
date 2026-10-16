// Display currency: every amount is stored in USD and shown in the user's
// currency, with two decimals for prices. Rates come from the European Central
// Bank's free daily reference rates (convex/currency.ts refreshes them).

export const CURRENCIES = ["USD", "EUR", "GBP", "DKK"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const isCurrency = (c: string | undefined): c is CurrencyCode => CURRENCIES.includes(c as CurrencyCode);

// Used until the first daily refresh, so amounts are never shown unconverted.
export const FALLBACK_RATES: Record<CurrencyCode, number> = { USD: 1, EUR: 0.89, GBP: 0.75, DKK: 6.67 };

// Currencies the ECB doesn't publish that are pegged to the dollar (units per USD): exact without a feed.
export const PEGGED_PER_USD: Record<string, number> = { AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845, JOD: 0.709 };

/** USD → currency rates with the dollar-pegged Gulf currencies added. */
export const withPegged = (all: Record<string, number>): Record<string, number> => ({ ...PEGGED_PER_USD, ...all });

/**
 * The same ECB rates from Frankfurter (api.frankfurter.dev, free, no key), for days the ECB's own file can't be
 * read: { amount: 1, base: "USD", rates: { EUR: 0.89, … } }. Null if it can't be read.
 */
export function ratesFromFrankfurter(body: unknown): { rates: Record<CurrencyCode, number>; all: Record<string, number>; date: string } | null {
  const b = body as { base?: string; date?: string; rates?: Record<string, unknown> } | null;
  if (b?.base !== "USD" || !b.rates) return null;
  const all: Record<string, number> = { USD: 1 };
  for (const [c, r] of Object.entries(b.rates)) if (/^[A-Z]{3}$/.test(c) && typeof r === "number" && r > 0) all[c] = r;
  if (!all.EUR || !all.GBP || !all.DKK) return null;
  return { rates: { USD: 1, EUR: all.EUR, GBP: all.GBP, DKK: all.DKK }, all, date: typeof b.date === "string" ? b.date : new Date().toISOString().slice(0, 10) };
}

/** USD → currency rates from the ECB daily XML (which is EUR-based). Null if it can't be read. */
export function ratesFromEcbXml(xml: string): Record<CurrencyCode, number> | null {
  const eur: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) eur[m[1]] = Number(m[2]);
  const usdPerEur = eur.USD;
  if (!(usdPerEur > 0) || !(eur.GBP > 0) || !(eur.DKK > 0)) return null;
  return { USD: 1, EUR: 1 / usdPerEur, GBP: eur.GBP / usdPerEur, DKK: eur.DKK / usdPerEur };
}

/** Every currency the ECB publishes, as USD → currency rates (for store prices). */
export function allUsdRatesFromEcbXml(xml: string): Record<string, number> {
  const eur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) eur[m[1]] = Number(m[2]);
  const usdPerEur = eur.USD;
  if (!(usdPerEur > 0)) return {};
  return Object.fromEntries(Object.entries(eur).map(([c, r]) => [c, r / usdPerEur]));
}

/** A price in `currency` converted to USD; undefined when we have no rate for it. */
export function toUsdWith(amount: number, currency: string | undefined, usdRates: Record<string, number>): number | undefined {
  if (!currency || currency === "USD") return amount;
  const rate = usdRates[currency];
  return rate > 0 ? Math.round((amount / rate) * 100) / 100 : undefined;
}

/**
 * An amount stored in USD, shown in `code`. Prices always get two decimals
 * ("€18.90"); `compact` is for large estimates ("€12.4K").
 */
export function formatMoney(usd: number, code: CurrencyCode, rate: number, opts: { compact?: boolean } = {}): string {
  const value = usd * rate;
  const compact = opts.compact && Math.abs(value) >= 1000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    ...(compact
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { minimumFractionDigits: opts.compact ? 0 : 2, maximumFractionDigits: opts.compact ? 0 : 2 }),
  }).format(value);
}
