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
};

export type AdField =
  | "advertiserName" | "headline" | "bodyText" | "creativeUrl" | "videoUrl" | "landingPageUrl"
  | "platform" | "country" | "niche" | "spend" | "likes" | "views" | "comments" | "shares"
  | "daysRunning" | "firstSeen" | "lastSeen" | "ctaText" | "adLibraryUrl" | "adId";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
// Earlier aliases win.
const ALIASES: Record<AdField, string[]> = {
  adId: ["adid", "adkey", "id", "adarchiveid", "archiveid", "libraryid", "videoid"],
  advertiserName: ["advertiser", "advertisername", "pagename", "page", "brand", "store", "storename", "shopname", "author", "username", "account"],
  headline: ["headline", "title", "adtitle", "linktitle", "name", "producttitle", "productname"],
  bodyText: ["bodytext", "body", "adtext", "adcopy", "copy", "text", "caption", "description", "primarytext", "message"],
  creativeUrl: ["creativeurl", "imageurl", "image", "thumbnail", "thumbnailurl", "cover", "coverurl", "poster", "preview", "adimage", "picture", "img"],
  videoUrl: ["videourl", "video", "videolink", "mediaurl"],
  landingPageUrl: ["landingpage", "landingpageurl", "landingurl", "producturl", "productlink", "storeurl", "shopurl", "linkurl", "destinationurl", "url", "link"],
  platform: ["platform", "network", "channel", "publisherplatform"],
  country: ["country", "countrycode", "region", "market", "countries", "geo", "location"],
  niche: ["niche", "category", "producttype", "vertical"],
  spend: ["spend", "spendestimate", "adspend", "estimatedspend", "budget"],
  likes: ["likes", "likecount", "reactions", "diggcount", "totallikes"],
  views: ["views", "viewcount", "plays", "playcount", "impressions", "reach", "totalreach"],
  comments: ["comments", "commentcount"],
  shares: ["shares", "sharecount"],
  daysRunning: ["daysrunning", "days", "runningdays", "activedays", "duration", "adduration"],
  firstSeen: ["firstseen", "firstseenat", "startdate", "adstartdate", "created", "createdat", "launchdate", "publishedat", "date"],
  lastSeen: ["lastseen", "lastseenat", "enddate", "adenddate", "updatedat"],
  ctaText: ["cta", "ctatext", "calltoaction", "button", "buttontext"],
  adLibraryUrl: ["adlibraryurl", "adlibrarylink", "adurl", "adlink", "sourceurl", "detailurl", "postlink", "posturl"],
};
const ORDER: AdField[] = [
  "adId", "advertiserName", "headline", "bodyText", "creativeUrl", "videoUrl", "adLibraryUrl", "landingPageUrl",
  "platform", "country", "niche", "spend", "likes", "views", "comments", "shares", "daysRunning", "firstSeen", "lastSeen", "ctaText",
];

export type AdColumnMap = Partial<Record<AdField, number>>;

export function autoMapAds(header: string[]): AdColumnMap {
  const h = header.map(norm);
  const used = new Set<number>();
  const map: AdColumnMap = {};
  for (const f of ORDER) {
    for (const alias of ALIASES[f]) {
      const idx = h.indexOf(alias);
      if (idx >= 0 && !used.has(idx)) {
        map[f] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return map;
}

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
  const [, ...data] = table;
  const now = opts.now ?? new Date();
  const seen = new Set<string>();
  const rows: AdRow[] = [];
  let duplicates = 0;
  let invalid = 0;
  const get = (r: string[], f: AdField) => (map[f] !== undefined ? (r[map[f]!] ?? "").trim() : undefined);

  for (const r of data) {
    const image = get(r, "creativeUrl");
    const video = get(r, "videoUrl");
    const headlineRaw = get(r, "headline") ?? "";
    const body = get(r, "bodyText") ?? "";
    const advertiserRaw = get(r, "advertiserName") ?? "";
    if ((!isUrl(image) && !isUrl(video)) || (!headlineRaw && !body && !advertiserRaw)) {
      invalid++;
      continue;
    }
    const landing = get(r, "landingPageUrl");
    const libraryUrl = get(r, "adLibraryUrl");
    const platform = normPlatform(get(r, "platform"), opts.platform);
    let advertiser = advertiserRaw;
    if (!advertiser && isUrl(landing)) {
      try {
        advertiser = new URL(landing).hostname.replace(/^www\./, "");
      } catch {
        /* keep empty */
      }
    }
    advertiser = (advertiser || "Unknown advertiser").slice(0, 120);
    const headline = (headlineRaw || body.split(/\n/)[0] || advertiser).slice(0, 200);

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
    const firstSeenAt = (firstSeen ?? new Date(now.getTime() - days * dayMs)).toISOString();

    const likes = Math.max(0, Math.round(toNumber(get(r, "likes")) ?? 0));
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
      aiScore: adScore(likes, viewsNum, days),
      firstSeenAt,
      mediaType: isUrl(video) ? "video" : "image",
      ...(isUrl(video) ? { videoUrl: video } : {}),
      ...(get(r, "ctaText") ? { ctaText: get(r, "ctaText")!.slice(0, 40) } : {}),
      ...(viewsNum !== undefined ? { impressions: Math.round(viewsNum) } : {}),
      ...(toNumber(get(r, "comments")) !== undefined ? { comments: Math.round(toNumber(get(r, "comments"))!) } : {}),
      ...(toNumber(get(r, "shares")) !== undefined ? { shares: Math.round(toNumber(get(r, "shares"))!) } : {}),
      ...(lastSeen ? { lastSeenAt: lastSeen.toISOString() } : {}),
      ...(countries.length ? { countries } : {}),
      ...(isUrl(libraryUrl) ? { adLibraryUrl: libraryUrl } : {}),
    });
  }
  return { rows, total: data.length, duplicates, invalid };
}

export const AD_TEMPLATE_CSV =
  "ad_id,advertiser,platform,country,headline,body,image_url,video_url,landing_page,niche,likes,views,comments,shares,spend,first_seen,cta\n" +
  '123456789,Paws & Co,Facebook,US,"Keep your dog cool all summer","No water, no power — just lay it down.",https://example.com/mat.jpg,https://example.com/mat.mp4,https://yourstore.com/products/mat,Pet Supplies,15400,1200000,320,85,5000,2026-08-01,Shop now\n';
