// CSV → ad rows for the Admin "Import ads CSV" dialog. Reuses the product
// CSV reader (encodings, separators, quoting) and maps columns from Minea,
// PiPiAds, WinningHunter, Meta Ad Library scrapes and simple own sheets.

import { classifyNiche, NICHES } from "@/convex/lib/category.ts";
import { toNumber } from "@/lib/productCsv.ts";

export { decodeCsvBytes, parseCsv } from "@/lib/productCsv.ts";

export const AD_PLATFORMS = ["Facebook", "Instagram", "TikTok", "YouTube", "Pinterest", "Snapchat"] as const;
export const IMPORT_NICHES = NICHES;

// Same shape as `adFields` in convex/sources/links.ts (the importAds mutation).
export type AdRow = {
  externalId: string;
  source: string;
  advertiserName: string;
  platform: string;
  country: string;
  niche: string;
  headline: string;
  bodyText: string;
  creativeUrl: string;
  landingPageUrl: string;
  spendEstimate: string;
  likes: number;
  views: string;
  daysRunning: number;
  aiScore: number;
  firstSeenAt: string;
  mediaType?: string;
  videoUrl?: string;
  ctaText?: string;
  impressions?: number;
  comments?: number;
  shares?: number;
  lastSeenAt?: string;
  isActive?: boolean;
  countries?: string[];
  adLibraryUrl?: string;
  relatedAdsCount?: number;
};

export type AdField =
  | "advertiserName" | "headline" | "bodyText" | "creativeUrl" | "videoUrl" | "landingPageUrl"
  | "platform" | "country" | "niche" | "spend" | "likes" | "views" | "comments" | "shares"
  | "daysRunning" | "firstSeen" | "lastSeen" | "ctaText" | "adLibraryUrl" | "adId" | "copies";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
// Earlier aliases win.
const ALIASES: Record<AdField, string[]> = {
  adId: ["adid", "adkey", "id", "adarchiveid", "archiveid", "libraryid", "videoid"],
  advertiserName: ["advertiser", "advertisername", "pagename", "page", "shop", "shopname", "store", "storename", "seller", "sellername", "brand", "author", "username", "account"],
  headline: ["headline", "title", "adtitle", "linktitle", "name", "producttitle", "productname", "products", "product"],
  bodyText: ["bodytext", "body", "adtext", "adcopy", "copy", "text", "caption", "description", "primarytext", "message"],
  creativeUrl: ["creativeurl", "imageurl", "image", "productimageurl", "productimage", "imagelink", "mainimage", "coverimage", "coverimageurl", "videocover", "thumbnail", "thumbnailurl", "cover", "coverurl", "poster", "preview", "adimage", "picture", "img"],
  videoUrl: ["videourl", "video", "videolink", "mediaurl"],
  landingPageUrl: ["landingpage", "landingpageurl", "landingurl", "producturl", "productlink", "storeurl", "shopurl", "linkurl", "destinationurl", "tiktokurl", "tiktoklink", "tiktokshopurl", "url", "link"],
  platform: ["platform", "network", "channel", "publisherplatform"],
  country: ["country", "countrycode", "region", "market", "countries", "geo", "location"],
  niche: ["niche", "category", "productcategory", "producttype", "vertical"],
  spend: ["spend", "spendestimate", "adspend", "estimatedspend", "budget"],
  likes: ["likes", "likecount", "reactions", "diggcount", "totallikes"],
  views: ["views", "viewcount", "plays", "playcount", "impressions", "reach", "totalreach"],
  comments: ["comments", "commentcount"],
  shares: ["shares", "sharecount"],
  daysRunning: ["daysrunning", "days", "runningdays", "activedays", "duration", "adduration"],
  firstSeen: ["firstseen", "firstseenat", "startdate", "adstartdate", "started", "startedrunning", "startedrunningon", "created", "createdat", "launchdate", "publishedat", "estimatedlisteddate", "listeddate", "listingdate", "date"],
  lastSeen: ["lastseen", "lastseenat", "enddate", "adenddate", "updatedat"],
  ctaText: ["cta", "ctatext", "calltoaction", "button", "buttontext"],
  copies: ["advariations", "variations", "adcopies", "copies", "collationcount", "relatedadscount", "numberofcopies"],
  adLibraryUrl: ["adlibraryurl", "adlibrarylink", "adurl", "adlink", "sourceurl", "detailurl", "postlink", "posturl"],
};
const ORDER: AdField[] = [
  "adId", "advertiserName", "headline", "bodyText", "creativeUrl", "videoUrl", "adLibraryUrl", "landingPageUrl",
  "platform", "country", "niche", "spend", "likes", "views", "comments", "shares", "daysRunning", "firstSeen", "lastSeen", "ctaText", "copies",
];

export type AdColumnMap = Partial<Record<AdField, number>>;

// Loose fallbacks for columns the exact aliases miss, e.g. "Main Image (URL)".
const FUZZY: Partial<Record<AdField, string[]>> = {
  creativeUrl: ["image", "img", "thumbnail", "cover", "picture", "photo"],
  headline: ["title", "product", "name"],
  advertiserName: ["advertiser", "shop", "store", "brand", "page"],
  landingPageUrl: ["url", "link"],
  niche: ["category", "niche"],
  country: ["country"],
};
const IMAGE_VALUE = /\.(jpe?g|png|webp|gif|avif)(\?|~|$)|[/._-](image|img|thumb|cover)|tplv-|ttcdn|fbcdn|scontent/i;

// `sample` (the first data rows) lets us find an image column by its values
// when the header gives no hint.
export function autoMapAds(header: string[], sample: string[][] = []): AdColumnMap {
  const h = header.map(norm);
  const used = new Set<number>();
  const map: AdColumnMap = {};
  const take = (f: AdField, idx: number) => {
    map[f] = idx;
    used.add(idx);
  };
  for (const f of ORDER) {
    for (const alias of ALIASES[f]) {
      const idx = h.indexOf(alias);
      if (idx >= 0 && !used.has(idx)) {
        take(f, idx);
        break;
      }
    }
  }
  const rows = sample.slice(0, 10);
  const urlShare = (idx: number, re: RegExp) => {
    const vals = rows.map((r) => (r[idx] ?? "").trim()).filter(Boolean);
    return vals.length ? vals.filter((v) => /^https?:\/\//i.test(v) && re.test(v)).length / vals.length : 0;
  };
  if (map.creativeUrl === undefined && map.videoUrl === undefined) {
    const idx = h.findIndex((_, i) => !used.has(i) && urlShare(i, IMAGE_VALUE) >= 0.5);
    if (idx >= 0) take("creativeUrl", idx);
  }
  for (const f of ORDER) {
    if (map[f] !== undefined || !FUZZY[f]) continue;
    const idx = h.findIndex(
      (col, i) =>
        !used.has(i) &&
        FUZZY[f]!.some((k) => col.includes(k)) &&
        // a URL column only counts as a landing page / image if it holds URLs
        (f === "landingPageUrl" || f === "creativeUrl" ? urlShare(i, /./) >= 0.5 || rows.length === 0 : true),
    );
    if (idx >= 0) take(f, idx);
  }
  return map;
}

// Product-finder exports (Kalodata, FastMoss, TikTok Shop…) list products with
// sales numbers, not ads: no likes, views or comments. Imported as ads they
// show as empty cards, so the dialog sends them to the products import.
const PRODUCT_EXPORT_COLUMNS = /^(itemssold|unitssold|gmv|totalgmv|productprice|productrating|productreviews|affiliatesalesshare|activeinfluencers)/;
export function isProductExport(header: string[], map: AdColumnMap): boolean {
  const hasEngagement = map.likes !== undefined || map.views !== undefined || map.comments !== undefined || map.shares !== undefined;
  return !hasEngagement && header.some((h) => PRODUCT_EXPORT_COLUMNS.test(norm(h)));
}

// A file with no engagement (likes, views, comments, shares) and no dates
// (start date, days running) gives ads with every number empty.
export function lacksNumbers(map: AdColumnMap): boolean {
  return (["likes", "views", "comments", "shares", "daysRunning", "firstSeen"] as AdField[]).every((f) => map[f] === undefined);
}

// "-", "N/A" and similar placeholders count as empty.
const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return /^(-+|—|n\/?a|null|none|undefined)$/i.test(t) ? "" : t;
};

const isUrl = (s: string | undefined): s is string => !!s && /^https?:\/\//i.test(s);

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  // Unix seconds / milliseconds
  if (/^\d{10}$/.test(t)) return new Date(Number(t) * 1000);
  if (/^\d{13}$/.test(t)) return new Date(Number(t));
  // 31/12/2025 or 31.12.2025 (day first, as most EU exports)
  const dmy = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy && Number(dmy[1]) > 12) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function normPlatform(s: string | undefined, fallback: string): string {
  const t = (s ?? "").toLowerCase();
  if (!t) return fallback;
  if (t.includes("tiktok")) return "TikTok";
  if (t.includes("insta")) return "Instagram";
  if (t.includes("face") || t === "fb" || t.includes("meta")) return "Facebook";
  if (t.includes("youtube")) return "YouTube";
  if (t.includes("pinterest")) return "Pinterest";
  if (t.includes("snap")) return "Snapchat";
  return fallback;
}

// A TikTok / Instagram / Facebook link tells us the platform when no column does.
function urlPlatform(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/^https?:\/\/(?:[a-z0-9-]+\.)*(tiktok|instagram|facebook|fb|youtube|pinterest|snapchat)\.com/i);
  return m ? m[1] : "";
}

// "US", "us", "US, GB", "United Kingdom" (only codes are kept).
function parseCountries(s: string | undefined): string[] {
  if (!s) return [];
  const names: Record<string, string> = {
    unitedstates: "US", usa: "US", unitedkingdom: "GB", uk: "GB", greatbritain: "GB", germany: "DE", france: "FR",
    spain: "ES", italy: "IT", denmark: "DK", sweden: "SE", norway: "NO", netherlands: "NL", canada: "CA", australia: "AU",
  };
  const out: string[] = [];
  for (const part of s.split(/[,;|/]/)) {
    const p = part.trim();
    if (/^[a-z]{2}$/i.test(p)) out.push(p.toUpperCase());
    else if (names[norm(p)]) out.push(names[norm(p)]);
  }
  return [...new Set(out)];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${Math.round(n)}`;

// Honest 0-100 score from the file's own signals (likes, views, days running).
// Meta Ad Library rows have no likes or views: score them like the Apify
// import does, on longevity and the number of ad copies (scaling).
export function metaScore(days: number, copies: number | undefined): number {
  return Math.max(1, Math.min(100, Math.round((Math.min(days, 60) / 60) * 60 + (Math.min(copies ?? 1, 20) / 20) * 40)));
}

export function adScore(likes: number, views: number | undefined, days: number): number {
  const l = Math.min(Math.log10(1 + likes) / 6, 1) * 45; // 1M likes ≈ full
  const v = Math.min(Math.log10(1 + (views ?? 0)) / 7, 1) * 30; // 10M views ≈ full
  const d = (Math.min(days, 60) / 60) * 25; // running 60+ days ≈ full
  return Math.max(1, Math.min(100, Math.round(l + v + d)));
}

function adKey(id: string | undefined, libraryUrl: string | undefined, platform: string, advertiser: string, media: string): string {
  if (id) return `csv:${platform.toLowerCase()}:${id.toLowerCase()}`;
  if (libraryUrl) {
    try {
      const u = new URL(libraryUrl);
      return `csv:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.searchParams.get("id") ?? ""}`.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return `csv:${advertiser.trim().toLowerCase().slice(0, 80)}|${media.split("?")[0]}`.slice(0, 400);
}

export type AdBuildResult = { rows: AdRow[]; total: number; duplicates: number; invalid: number };

export function buildAdRows(
  table: string[][],
  map: AdColumnMap,
  opts: { niche: "auto" | string; platform: string; country: string; source?: string; now?: Date },
): AdBuildResult {
  const [header, ...data] = table;
  const now = opts.now ?? new Date();
  const seen = new Set<string>();
  const rows: AdRow[] = [];
  let duplicates = 0;
  let invalid = 0;
  const get = (r: string[], f: AdField) => (map[f] !== undefined ? clean(r[map[f]!]) : undefined);
  const mapped = new Set(Object.values(map));

  for (const r of data) {
    const image = get(r, "creativeUrl");
    const video = get(r, "videoUrl");
    const headlineRaw = get(r, "headline") ?? "";
    // No ad-text column (e.g. product-finder exports): keep the other columns
    // (price, items sold, GMV…) as readable text instead of dropping them.
    const body =
      map.bodyText !== undefined
        ? (get(r, "bodyText") ?? "")
        : header
            .map((h, i) => (mapped.has(i) || !h.trim() ? "" : clean(r[i]) && !isUrl(clean(r[i])) ? `${h.trim()}: ${clean(r[i])}` : ""))
            .filter(Boolean)
            .slice(0, 12)
            .join(" · ");
    const advertiserRaw = get(r, "advertiserName") ?? "";
    if ((!isUrl(image) && !isUrl(video)) || (!headlineRaw && !body && !advertiserRaw)) {
      invalid++;
      continue;
    }
    const landing = get(r, "landingPageUrl");
    const libraryUrl = get(r, "adLibraryUrl");
    const platform = normPlatform(get(r, "platform") || urlPlatform(landing ?? libraryUrl), opts.platform);
    let advertiser = advertiserRaw;
    if (!advertiser && isUrl(landing)) {
      try {
        advertiser = new URL(landing).hostname.replace(/^www\./, "");
      } catch {
        /* keep empty */
      }
    }
    advertiser = (advertiser || "Unknown advertiser").slice(0, 120);
    // Ad-library scrapes (ScrapeKit) often have the advertiser as the "title": use the ad's first line then.
    const titleIsAdvertiser = !!headlineRaw && !!body && headlineRaw.trim().toLowerCase() === advertiser.trim().toLowerCase();
    const headline = ((titleIsAdvertiser ? "" : headlineRaw) || body.split(/\n/)[0] || advertiser).slice(0, 200);

    const key = adKey(get(r, "adId"), isUrl(libraryUrl) ? libraryUrl : undefined, platform, advertiser, (isUrl(video) ? video : image) ?? "");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    const firstSeen = parseDate(get(r, "firstSeen"));
    const lastSeen = parseDate(get(r, "lastSeen"));
    const dayMs = 86_400_000;
    const daysCol = toNumber(get(r, "daysRunning"));
    const days = Math.max(
      0,
      Math.round(daysCol ?? (firstSeen ? ((lastSeen ?? now).getTime() - firstSeen.getTime()) / dayMs : 0)),
    );
    // Dated by the import, not the file: Ad Spy and the admin list sort by
    // first-seen, and back-dated rows would sink below every newer ad.
    const firstSeenAt = now.toISOString();

    const likes = Math.max(0, Math.round(toNumber(get(r, "likes")) ?? 0));
    const copiesNum = toNumber(get(r, "copies"));
    const copies = copiesNum !== undefined && copiesNum >= 1 ? Math.round(copiesNum) : undefined;
    const viewsNum = toNumber(get(r, "views"));
    const spendRaw = get(r, "spend") ?? "";
    const spendNum = /^[$€£]?\s*[\d.,]+\s*[kKmM]?$/.test(spendRaw) ? toNumber(spendRaw) : undefined;
    const spendEstimate = spendNum !== undefined ? `$${compact(spendNum)}` : spendRaw.slice(0, 40) || "Unknown";

    const countries = parseCountries(get(r, "country"));
    const country = countries[0] ?? opts.country;
    const hint = get(r, "niche");
    const niche =
      opts.niche !== "auto"
        ? opts.niche
        : hint && (IMPORT_NICHES as readonly string[]).includes(hint)
          ? hint
          : classifyNiche({ title: headline, body: `${body} ${hint ?? ""}`, url: isUrl(landing) ? landing : undefined, advertiser });

    rows.push({
      externalId: key,
      source: opts.source ?? "csv_import",
      advertiserName: advertiser,
      platform,
      country,
      niche,
      headline,
      bodyText: body.slice(0, 5000),
      creativeUrl: isUrl(image) ? image : "",
      landingPageUrl: isUrl(landing) ? landing : "",
      spendEstimate,
      likes,
      views: viewsNum !== undefined ? compact(viewsNum) : "—",
      daysRunning: days,
      aiScore:
        likes === 0 && viewsNum === undefined && toNumber(get(r, "comments")) === undefined
          ? metaScore(days, copies)
          : adScore(likes, viewsNum, days),
      firstSeenAt,
      mediaType: isUrl(video) ? "video" : "image",
      ...(isUrl(video) ? { videoUrl: video } : {}),
      ...(get(r, "ctaText") ? { ctaText: get(r, "ctaText")!.slice(0, 40) } : {}),
      ...(viewsNum !== undefined ? { impressions: Math.round(viewsNum) } : {}),
      ...(toNumber(get(r, "comments")) !== undefined ? { comments: Math.round(toNumber(get(r, "comments"))!) } : {}),
      ...(toNumber(get(r, "shares")) !== undefined ? { shares: Math.round(toNumber(get(r, "shares"))!) } : {}),
      lastSeenAt: (lastSeen ?? now).toISOString(),
      ...(countries.length ? { countries } : {}),
      ...(isUrl(libraryUrl) ? { adLibraryUrl: libraryUrl } : {}),
      ...(copies !== undefined ? { relatedAdsCount: copies } : {}),
    });
  }
  return { rows, total: data.length, duplicates, invalid };
}

export const AD_TEMPLATE_CSV =
  "ad_id,advertiser,platform,country,headline,body,image_url,video_url,landing_page,niche,likes,views,comments,shares,spend,first_seen,cta\n" +
  '123456789,Paws & Co,Facebook,US,"Keep your dog cool all summer","No water, no power — just lay it down.",https://example.com/mat.jpg,https://example.com/mat.mp4,https://yourstore.com/products/mat,Pet Supplies,15400,1200000,320,85,5000,2026-08-01,Shop now\n';
