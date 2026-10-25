// Small display helpers shared by Ad Spy cards and the ad detail view.
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function compactNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1_000) return Math.round(n).toLocaleString();
  return compactFormat.format(n);
}

// An amount that is in a marketplace's or shop's own currency ("€12.90", "¥1,200"); an unknown code shows as "XYZ 12.90".
export function inCurrency(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function flag(code: string | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function shortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Spend strings carry a source note ("(AdLibrary est.)"); cards show just the value.
export function spendLabel(spend: string | undefined): string | null {
  if (!spend || /^unknown$|\$0–\$0/i.test(spend)) return null;
  return spend.replace(/\s*\((impression-based est\.|AdLibrary est\.|Nexscope est\.|WinningHunter est\.|PiPiSpy est\.)\)/, "");
}
