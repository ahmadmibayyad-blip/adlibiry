// Reading a product's real selling price, for products found in ads (which
// carry no price): from the ad's own text when an import put it there
// ("Product Price: $12.61"), or from the store's product page, which almost
// always publishes it for Google/Facebook (og:price / product:price meta tags,
// JSON-LD Product offers, or itemprop="price").

export type FoundPrice = { amount: number; currency: string };

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", kr: "DKK" };

// Approximate USD rates, used only to show foreign prices in dollars; the
// store's own amount and currency are kept alongside (originalPrice).
const USD_PER: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, DKK: 0.145, SEK: 0.095, NOK: 0.093, CAD: 0.73, AUD: 0.66,
  NZD: 0.6, CHF: 1.12, PLN: 0.25, CZK: 0.043, JPY: 0.0067, INR: 0.012, AED: 0.27, SGD: 0.74, MXN: 0.055,
};

export function toUsd(p: FoundPrice): number | undefined {
  const rate = USD_PER[p.currency.toUpperCase()];
  return rate ? Math.round(p.amount * rate * 100) / 100 : undefined;
}

export const priceLabel = (p: FoundPrice) => `${p.currency.toUpperCase()} ${p.amount.toFixed(2)}`;

// "1.299,00" → 1299, "1,299.00" → 1299, "29.95" → 29.95, "29,95" → 29.95
export function parseAmount(raw: string): number | undefined {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return undefined;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : undefined;
}

// "Product Price: $12.61 · …" as written by the CSV import.
export function priceFromAdText(text: string): FoundPrice | undefined {
  const m = text.match(/\b(?:product\s+|usd\s+)?price:\s*([$€£¥]|[A-Z]{3}\s?)?\s*([\d.,]+)/i);
  if (!m) return undefined;
  const amount = parseAmount(m[2]);
  if (amount === undefined) return undefined;
  const sym = m[1]?.trim();
  const currency = !sym ? "USD" : SYMBOLS[sym] ?? sym.toUpperCase();
  return { amount, currency };
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return content;
  }
  return undefined;
}

function fromJsonLd(html: string): FoundPrice | undefined {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const o = node as Record<string, unknown>;
      const price = o.price ?? o.lowPrice;
      if ((typeof price === "string" || typeof price === "number") && (o["@type"] === "Offer" || o["@type"] === "AggregateOffer" || o.priceCurrency)) {
        const amount = parseAmount(String(price));
        if (amount !== undefined) return { amount, currency: String(o.priceCurrency ?? "USD").toUpperCase() };
      }
      stack.push(...Object.values(o));
    }
  }
  return undefined;
}

export function priceFromHtml(html: string): FoundPrice | undefined {
  const metaAmount = metaContent(html, ["og:price:amount", "product:price:amount"]);
  const amount = metaAmount ? parseAmount(metaAmount) : undefined;
  if (amount !== undefined) {
    const currency = metaContent(html, ["og:price:currency", "product:price:currency"]) ?? "USD";
    return { amount, currency: currency.toUpperCase() };
  }
  const ld = fromJsonLd(html);
  if (ld) return ld;
  const itemprop = html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i)?.[1];
  const ipAmount = itemprop ? parseAmount(itemprop) : undefined;
  if (ipAmount !== undefined) {
    const cur = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([A-Z]{3})["']/i)?.[1] ?? "USD";
    return { amount: ipAmount, currency: cur };
  }
  return undefined;
}

// Only public http(s) sites: no IP addresses, no localhost or internal names.
export function isFetchableUrl(url: string | undefined): url is string {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return false;
  return true;
}
