// Validates and normalizes one ad POSTed by the Chrome extension
// (public/chrome-extension/parsers.js → finalize()). Pure, so it's unit-tested.
// Only the identity fields are required; everything else the extension
// scraped (video, CTA, engagement, countries, start date, Ad Library id) is
// kept when present and well-formed, instead of being thrown away.
import { toAlpha2List } from "./countryCodes";

export type ExtensionSubmission = {
  submitterVisitorId: string;
  advertiserName: string;
  platform: string;
  headline: string;
  bodyText: string;
  creativeUrl: string;
  landingPageUrl: string;
  sourceUrl: string;
  adKey?: string;
  videoUrl?: string;
  ctaText?: string;
  advertiserAvatar?: string;
  mediaType?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
  countries?: string[];
  isActive?: boolean;
  startedAt?: string;
  adLibraryUrl?: string;
};

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const http = (value: unknown, max = 2000): string | undefined => {
  const s = str(value, max);
  return /^https?:\/\//i.test(s) ? s : undefined;
};
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const iso = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const d = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  const t = d.getTime();
  // Reject junk and future dates (a bad parse must not make an ad look brand new).
  return Number.isFinite(t) && t > Date.UTC(2004, 0, 1) && t <= Date.now() + 86_400_000 ? d.toISOString() : undefined;
};
const MEDIA_TYPES = new Set(["image", "video", "carousel"]);

function firstVideo(videos: unknown): string | undefined {
  if (!Array.isArray(videos)) return undefined;
  for (const v of videos) {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const url = http(o.hd) ?? http(o.sd);
      if (url) return url;
    }
  }
  return undefined;
}

export function parseExtensionAd(
  body: unknown,
): { ok: true; submission: ExtensionSubmission } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  for (const field of ["visitorId", "advertiserName", "platform"]) {
    if (typeof b[field] !== "string" || (b[field] as string).trim().length === 0) {
      return { ok: false, error: `Missing or invalid field: ${field}` };
    }
  }

  const bodyText = str(b.bodyText, 2000);
  const headline = str(b.headline, 500) || bodyText.split("\n")[0].slice(0, 200) || "Sponsored ad";
  const creativeUrl = str(b.creativeUrl, 2000) || str(b.advertiserAvatar, 2000);
  if (!creativeUrl && !bodyText && headline === "Sponsored ad") {
    return { ok: false, error: "Ad has no creative or text" };
  }

  // Meta Ad Library captures share the Apify importer's key (meta_<archive
  // id>), so the same ad from both sources ends up as one Ad Spy row.
  const archiveId = str(b.adArchiveId, 64);
  const extKey = str(b.adKey, 300);
  const adKey = /^\d+$/.test(archiveId) ? `meta_${archiveId}` : extKey ? `ext:${extKey}` : undefined;

  const mediaType = str(b.mediaType, 20).toLowerCase();
  const countries = toAlpha2List(b.countries);
  // TikTok's `videoUrl` from the extension is the post's page, not a playable
  // file, so only the `videos` list (real media URLs) is used for playback.
  const videoUrl = firstVideo(b.videos);
  const impressions = count(b.reach) ?? count(b.views) ?? count(b.impressions);

  const submission: ExtensionSubmission = {
    submitterVisitorId: str(b.visitorId, 200),
    advertiserName: str(b.advertiserName, 200),
    platform: str(b.platform, 50),
    headline,
    bodyText,
    creativeUrl,
    landingPageUrl: str(b.landingPageUrl, 2000),
    sourceUrl: str(b.sourceUrl, 2000) || str(b.adLibraryUrl, 2000) || str(b.pageUrl, 2000),
    adKey,
    videoUrl,
    ctaText: str(b.ctaText, 60) || undefined,
    advertiserAvatar: http(b.advertiserAvatar),
    mediaType: MEDIA_TYPES.has(mediaType) ? mediaType : videoUrl ? "video" : undefined,
    likes: count(b.likes) ?? count(b.reactions),
    comments: count(b.comments),
    shares: count(b.shares),
    impressions,
    countries: countries.length ? countries : undefined,
    isActive: typeof b.isActive === "boolean" ? b.isActive : undefined,
    startedAt: iso(b.startDate) ?? iso(b.postedAt),
    adLibraryUrl: http(b.adLibraryUrl),
  };
  for (const k of Object.keys(submission) as (keyof ExtensionSubmission)[]) {
    if (submission[k] === undefined) delete submission[k];
  }
  return { ok: true, submission };
}

// Honest 0-100 starting score from what the extension actually saw: how long
// the ad has run plus engagement. Admins can still override it on approval.
export function scoreFromSignals(s: { startedAt?: string; likes?: number; comments?: number; shares?: number; impressions?: number }, nowMs = Date.now()): number {
  const days = s.startedAt ? Math.max(0, (nowMs - Date.parse(s.startedAt)) / 86_400_000) : 0;
  const engagement = (s.likes ?? 0) + 2 * (s.comments ?? 0) + 3 * (s.shares ?? 0);
  const score =
    (Math.min(days, 60) / 60) * 50 +
    (Math.min(Math.log10(1 + engagement), 5) / 5) * 30 +
    (Math.min(Math.log10(1 + (s.impressions ?? 0)), 7) / 7) * 20;
  return Math.max(1, Math.min(100, Math.round(score)));
}

export function daysSince(startedAt: string | undefined, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(1, Math.round((nowMs - t) / 86_400_000)) : 0;
}
