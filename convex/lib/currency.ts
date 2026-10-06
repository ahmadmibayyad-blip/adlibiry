// Display currency: every amount is stored in USD and shown in the user's
// currency, with two decimals for prices. Rates come from the European Central
// Bank's free daily reference rates (convex/currency.ts refreshes them).

export const CURRENCIES = ["USD", "EUR", "GBP", "DKK"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const isCurrency = (c: string | undefined): c is CurrencyCode => CURRENCIES.includes(c as CurrencyCode);

// Used until the first daily refresh, so amounts are never shown unconverted.
export const FALLBACK_RATES: Record<CurrencyCode, number> = { USD: 1, EUR: 0.86, GBP: 0.74, DKK: 6.4 };

/** USD → currency rates from the ECB daily XML (which is EUR-based). Null if it can't be read. */
export function ratesFromEcbXml(xml: string): Record<CurrencyCode, number> | null {
  const eur: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) eur[m[1]] = Number(m[2]);
  const usdPerEur = eur.USD;
  if (!(usdPerEur > 0) || !(eur.GBP > 0) || !(eur.DKK > 0)) return null;
  return { USD: 1, EUR: 1 / usdPerEur, GBP: eur.GBP / usdPerEur, DKK: eur.DKK / usdPerEur };
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
