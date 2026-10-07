// Money on screen: amounts are stored in USD and shown in the signed-in
// user's display currency (Settings → Currency), converted with the daily ECB
// rate from the server (convex/currency.ts). DashboardLayout sets the current
// currency on each render of the app shell and remounts the page when it
// changes, so these plain helpers work anywhere.
import { formatMoney, type CurrencyCode } from "@/convex/lib/currency.ts";

let current: { code: CurrencyCode; rate: number } = { code: "USD", rate: 1 };

export function setDisplayCurrency(code: CurrencyCode, rate: number) {
  current = { code, rate };
}

export const displayCurrency = () => current;

/** A price: always two decimals ("€18.90"). */
export const price = (usd: number) => formatMoney(usd, current.code, current.rate);

/** A large amount: compact ("€12.4K"), whole units below 1,000. */
export const moneyCompact = (usd: number) => formatMoney(usd, current.code, current.rate, { compact: true });
