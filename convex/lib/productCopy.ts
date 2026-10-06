// Product descriptions written by importers, in plain English. The order
// count stays as "N orders last week" because lib/estimates.ts reads it from
// the text (unitsPerMonthFromText).

export function shopifyDescription(orders?: number, ads?: number, stores?: number): string {
  const facts = [
    orders !== undefined ? `${orders.toLocaleString("en-US")} orders last week` : "",
    ads ? `${ads} Facebook ad${ads === 1 ? "" : "s"}` : "",
    stores ? `sold by ${stores} store${stores === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Running Facebook ads as of last week (est.).${facts.length ? ` ${facts.join(", ")}.` : ""}`;
}

const OLD_SHOPIFY = /^Shopify store product running Facebook ads(?: · (.*))?\.$/;

/** The old " · "-joined Shopify description rewritten; anything else unchanged. */
export function upgradeDescription(text: string): string {
  const m = text.match(OLD_SHOPIFY);
  if (!m) return text;
  const facts = (m[1] ?? "").split(" · ").map((f) => f.replace(/ \(est\.\)$/, "")).filter(Boolean);
  return `Running Facebook ads as of last week (est.).${facts.length ? ` ${facts.join(", ")}.` : ""}`;
}
