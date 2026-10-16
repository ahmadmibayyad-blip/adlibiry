// CJ Dropshipping (developers.cjdropshipping.com, API 2.0, free with a CJ account): a second supplier next to
// AliExpress. Its product search matched by title like AliExpress (lib/aliexpress.ts), and shipping cost and
// time to the user's country for the best match. Pure: convex/cj.ts calls the API.

import { MIN_MATCH, supplierMatchScore } from "./aliexpress";

export const CJ_API = "https://developers.cjdropshipping.com/api2.0/v1";

export type CjMatch = {
  pid: string;
  title: string;
  price: number; // USD, CJ's sell price before shipping
  url: string;
  imageUrl?: string;
  listed?: number; // stores that listed it on CJ
  inventory?: number; // pieces in CJ's warehouses
  similarity: number;
};

export type CjShipping = { method: string; priceUsd: number; days: string };

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.]+/g, " ").trim().split(" ")[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";

/** A CJ product page link (CJ's own pattern: /product/<name>-p-<id>.html). */
export const cjUrl = (pid: string, title: string) => `https://cjdropshipping.com/product/${slug(title)}-p-${pid}.html`;

/** The products in a /product/listV2 answer ({ data: { content: [{ productList: [...] }] } }). A price range counts from its low end. */
export function cjProducts(body: unknown): Omit<CjMatch, "similarity">[] {
  const content = (body as { data?: { content?: { productList?: unknown[] }[] } } | null)?.data?.content ?? [];
  return content.flatMap((c) =>
    (c.productList ?? []).flatMap((x) => {
      const p = x as Record<string, unknown>;
      const pid = typeof p.id === "string" || typeof p.id === "number" ? String(p.id) : "";
      const title = typeof p.nameEn === "string" ? p.nameEn.trim() : "";
      const price = num(p.nowPrice) ?? num(p.sellPrice);
      if (!pid || !title || !price) return [];
      const listed = num(p.listedNum);
      const inventory = num(p.warehouseInventoryNum);
      return [{
        pid,
        title: title.slice(0, 200),
        price: Math.round(price * 100) / 100,
        url: cjUrl(pid, title),
        ...(typeof p.bigImage === "string" && p.bigImage.startsWith("http") ? { imageUrl: p.bigImage } : {}),
        ...(listed ? { listed: Math.round(listed) } : {}),
        ...(inventory ? { inventory: Math.round(inventory) } : {}),
      }];
    }),
  );
}

/** The best title matches, most similar first (cheaper first when as similar). */
export function cjMatches(title: string, products: Omit<CjMatch, "similarity">[], n = 3): CjMatch[] {
  return products
    .map((p) => ({ ...p, similarity: Math.round(supplierMatchScore(title, p.title) * 100) / 100 }))
    .filter((p) => p.similarity >= MIN_MATCH)
    .sort((a, b) => b.similarity - a.similarity || a.price - b.price)
    .slice(0, n);
}

/** A product's first variant id and the countries its CJ warehouses have stock in (from /product/query). */
export function cjVariant(body: unknown): { vid: string; stockIn: string[] } | null {
  const d = (body as { data?: { variants?: { vid?: unknown; inventories?: { countryCode?: unknown; totalInventory?: unknown }[] }[] } } | null)?.data;
  const v = d?.variants?.find((x) => typeof x.vid === "string" || typeof x.vid === "number");
  if (!v) return null;
  const stockIn = [...new Set((v.inventories ?? []).filter((i) => typeof i.countryCode === "string" && (num(i.totalInventory) ?? 0) > 0).map((i) => String(i.countryCode)))];
  return { vid: String(v.vid), stockIn };
}

/** The cheapest and the fastest ways to ship it, from /logistic/freightCalculate. */
export function cjShippingOptions(body: unknown): { cheapest: CjShipping; fastest: CjShipping } | null {
  const list = (body as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(list)) return null;
  const options = list.flatMap((x) => {
    const o = x as { logisticName?: unknown; logisticPrice?: unknown; logisticAging?: unknown };
    const priceUsd = typeof o.logisticPrice === "number" ? o.logisticPrice : parseFloat(String(o.logisticPrice ?? ""));
    if (typeof o.logisticName !== "string" || !Number.isFinite(priceUsd) || priceUsd < 0) return [];
    return [{ method: o.logisticName, priceUsd: Math.round(priceUsd * 100) / 100, days: String(o.logisticAging ?? "").trim() }];
  });
  if (!options.length) return null;
  const maxDays = (s: CjShipping) => Math.max(...(s.days.match(/\d+/g) ?? ["999"]).map(Number));
  const cheapest = [...options].sort((a, b) => a.priceUsd - b.priceUsd || maxDays(a) - maxDays(b))[0];
  const fastest = [...options].sort((a, b) => maxDays(a) - maxDays(b) || a.priceUsd - b.priceUsd)[0];
  return { cheapest, fastest };
}
