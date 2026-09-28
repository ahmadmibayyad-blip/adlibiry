// Maps WinningHunter Meta ad-library rows (REST /api/v1/adlibrary or the MCP
// connector — same shape) to our ad + product records.
import { guessCategory } from "./category";

type WH = Record<string, any>;

const MAIN = ["US", "GB", "DK", "SE", "NO", "DE", "FR", "NL", "CA", "AU", "ES", "IT", "FI", "BE", "AT", "IE", "NZ", "CH", "PL", "PT", "AE", "SA"];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);
const clean = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const abs = (s: string) => (/^https?:\/\//.test(s) ? s : "");
const num = (x: unknown) => (typeof x === "number" ? x : Number(x)) || 0;
const looksLikeName = (s: string) =>
  s.length >= 4 && !/\d{3,}/.test(s) && /[aeiouy]/i.test(s) && !/[bcdfghjklmnpqrstvwxz]{4,}/i.test(s.replace(/\s+/g, "")) && !/^[a-z]{1,5}$/.test(s);
const isPromo = (s: string) => /\b(buy \d|get \d|free|% off|sale|limited time|today only|discount)\b/i.test(s);
const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
function slugTitle(url: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  } catch {
    return "";
  }
}

export type WhAd = {
  externalId: string; source: string; advertiserName: string; platform: string; country: string; niche: string;
  headline: string; bodyText: string; creativeUrl: string; landingPageUrl: string; spendEstimate: string;
  likes: number; views: string; daysRunning: number; aiScore: number; firstSeenAt: string;
  mediaType?: string; videoUrl?: string; impressions?: number; lastSeenAt?: string; isActive?: boolean;
  countries?: string[]; relatedAdsCount?: number; adLibraryUrl?: string;
  audience?: { totalReach?: number; ages: { bracket: string; pct: number }[]; countries: { code: string; pct: number }[] };
};
export type WhProduct = {
  title: string; imageUrl: string; productUrl: string; priceUsd?: number; originalPrice?: string; category: string;
  description?: string; ads?: number; researchUrl?: string; tags?: string[];
};

function strip<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

// preferCountries: the market(s) this import asked for. An ad that runs in
// DK and US, imported for DK, is a DK ad — not the first MAIN match (US).
export function whToRecords(data: WH[], nowMs = Date.now(), preferCountries: string[] = []): { ads: WhAd[]; products: WhProduct[] } {
  const ads: WhAd[] = [];
  const products: WhProduct[] = [];
  const seenProducts = new Set<string>();
  for (const a of data) {
    const id = String(a.productid ?? a.id ?? "");
    if (!id) continue;
    const copy = clean(a.copy, 700) || clean(a.description, 700);
    const started = a.started ? new Date(a.started) : undefined;
    const last = a.lastSeen ? new Date(a.lastSeen) : undefined;
    const days = num(a.daysrunning) || (started ? Math.max(0, Math.round(((last?.getTime() ?? nowMs) - started.getTime()) / 864e5)) : 0);
    const reach = num(a.total_eu_views);
    const spend = num(a.total_eu_adspend) || num(a.total_adspend);
    const copies = Math.max(num(a.countActive), num(a.activeSeen));
    const countries: string[] = Array.isArray(a.countries) ? a.countries.filter((c: unknown) => typeof c === "string" && /^[A-Z]{2}$/.test(c)) : [];
    const link = abs(clean(a.link || a.urlStore || a.product_url, 1000));
    const slug = slugTitle(link);
    const firstLine = stripEmoji(copy.split("\n")[0] ?? "").replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 90);
    const title = looksLikeName(slug) ? slug : firstLine && !isPromo(firstLine) ? firstLine : slug || clean(a.pageName, 120);
    const niche = guessCategory(`${title} ${copy.slice(0, 200)}`);
    const poster = abs(clean(a.poster, 1500)) || abs(clean(a.image, 1500)) || abs(clean(a.facebook_thumbnail_url, 1500));
    const video = abs(clean(a.video, 1500)) || abs(clean(a.facebook_video_url, 1500));
    if (!poster && !copy) continue;
    const score = Math.max(1, Math.min(100, Math.round(
      (Math.min(days, 90) / 90) * 35 + (Math.min(copies, 20) / 20) * 25 + (Math.log10(1 + reach) / 6) * 25 + (Math.log10(1 + spend) / 5) * 15,
    )));
    const adLibraryUrl = `https://www.facebook.com/ads/library/?id=${id}`;
    ads.push(strip({
      externalId: `wh:${id}`,
      source: "winninghunter",
      advertiserName: clean(a.pageName, 200) || "Unknown",
      platform: String(a.platform ?? "facebook").toLowerCase().includes("insta") ? "Instagram" : "Facebook",
      country: preferCountries.find((c) => countries.includes(c)) ?? MAIN.find((c) => countries.includes(c)) ?? countries[0] ?? "INTL",
      niche,
      headline: clean(copy.split("\n")[0], 200) || title || "Sponsored ad",
      bodyText: copy,
      creativeUrl: poster,
      landingPageUrl: link,
      spendEstimate: spend > 0 ? `$${compact(spend)} EU (WinningHunter est.)` : "Unknown",
      likes: 0,
      views: reach ? compact(reach) : "0",
      daysRunning: days,
      aiScore: score,
      firstSeenAt: (started && !Number.isNaN(started.getTime()) ? started : new Date(nowMs)).toISOString(),
      mediaType: a.display_format === "video" || video ? "video" : (a.cards?.length ?? 0) > 1 ? "carousel" : "image",
      videoUrl: video || undefined,
      impressions: reach || undefined,
      lastSeenAt: last && !Number.isNaN(last.getTime()) ? last.toISOString() : undefined,
      isActive: last ? nowMs - last.getTime() < 5 * 864e5 : undefined,
      countries: countries.length ? countries.slice(0, 60) : undefined,
      relatedAdsCount: copies || undefined,
      adLibraryUrl,
      audience: reach ? { totalReach: reach, ages: [], countries: [] } : undefined,
    }) as WhAd);

    const price = num(a.shopify_productprice);
    const rate = num(a.shopify_currency?.rate) || 1;
    if (link && poster && title && !seenProducts.has(link.split("?")[0])) {
      seenProducts.add(link.split("?")[0]);
      products.push(strip({
        title: title.slice(0, 300),
        imageUrl: poster,
        productUrl: link,
        priceUsd: price > 0 ? Math.round((price / rate) * 100) / 100 : undefined,
        originalPrice: price > 0 ? `${a.shopify_currency?.active ?? ""}${price}` : undefined,
        category: niche,
        description: copy.slice(0, 500) || undefined,
        ads: num(a.total_active_ads_on_page) || copies || undefined,
        researchUrl: adLibraryUrl,
        tags: ["WinningHunter", ...countries.slice(0, 3)],
      }) as WhProduct);
    }
  }
  return { ads, products };
}
