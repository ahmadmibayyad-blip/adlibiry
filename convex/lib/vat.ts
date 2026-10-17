// VAT (standard rates, by ISO country code) and the margin left after it. Pure.
// Shown as an assumption: the standard rate, not a reduced rate or the seller's VAT status.
import type { Margin } from "./researchReport";

export const VAT_RATES: Record<string, number> = {
  AT: 0.2,
  BE: 0.21,
  BG: 0.2,
  HR: 0.25,
  CY: 0.19,
  CZ: 0.21,
  DK: 0.25,
  EE: 0.24,
  FI: 0.255,
  FR: 0.2,
  DE: 0.19,
  GR: 0.24,
  HU: 0.27,
  IE: 0.23,
  IT: 0.22,
  LV: 0.21,
  LT: 0.21,
  LU: 0.17,
  MT: 0.18,
  NL: 0.21,
  PL: 0.23,
  PT: 0.23,
  RO: 0.21,
  SK: 0.23,
  SI: 0.22,
  ES: 0.21,
  SE: 0.25,
  GB: 0.2,
  NO: 0.25,
  CH: 0.081,
  AU: 0.1,
  NZ: 0.15,
};

/** The standard VAT rate for a country code (any case), or null when it isn't in the table. */
export function vatRate(country?: string): number | null {
  if (!country) return null;
  const rate = VAT_RATES[country.trim().toUpperCase()];
  return typeof rate === "number" ? rate : null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The margin with VAT taken out of the price first: profit = price ÷ (1 + rate) − cost − fees.
 * The fees are the card fees already in the margin. Break-even ad cost is profit after VAT, floored at 0.
 */
export function withVat(m: Margin, rate: number): { netPrice: number; profitAfterVat: number; breakEvenAfterVat: number } {
  const netPrice = cents(m.price / (1 + rate));
  const profitAfterVat = cents(m.price / (1 + rate) - m.cost - m.fees);
  return { netPrice, profitAfterVat, breakEvenAfterVat: Math.max(0, profitAfterVat) };
}
