// Maps PiPiSpy "AdSpy List" rows (/v3/api/open/adspy/list) to our ad records.
// Pure, so it's unit-tested. Field meanings are from PiPiSpy's API docs.
//
// Careful: the REQUEST's plat_type is 1=TikTok, 2=Facebook, but the RESPONSE's
// `platform` is 1=Facebook, 2=Instagram, 3=TikTok.
import { classifyNiche } from "./category";
import { toAlpha2List } from "./countryCodes";
import type { ExternalAd } from "../sources/links";

type Row = Record<string, unknown>;

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const http = (v: unknown) => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : "";
};
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const iso = (seconds: unknown): string | undefined => {
  const n = num(seconds);
  return n && n > 1e9 ? new Date((n < 1e12 ? n * 1000 : n)).toISOString() : undefined;
};
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);
const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${Math.round(n)}`);

const PLATFORM: Record<number, string> = { 1: "Facebook", 2: "Instagram", 3: "TikTok" };

export function pipiRowToAd(r: Row, opts: { preferCountries?: string[]; fallbackNiche?: string; nowMs?: number } = {}): ExternalAd | null {
  const id = str(r.video_id) || str(r.id);
  if (!id) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const carousel = Array.isArray(r.carousel) ? (r.carousel as Row[]) : [];
  const first = carousel[0] ?? {};

  const desc = str(r.desc) || str(r.app_title) || str(first.body);
  const headline = (desc.split("\n")[0] || str(first.title) || "Sponsored ad").slice(0, 300);
  const creative = http(r.cover) || http(r.image) || http(first.cover) || http(first.image);
  const video = http(r.video_url) || http(first.video_url);
  if (!creative && !desc) return null;

  const countries = toAlpha2List(r.fetch_region);
  const prefer = opts.preferCountries ?? [];
  const country = prefer.find((c) => countries.includes(c)) ?? countries[0] ?? "INTL";

  const plays = num(r.play_count);
  const likes = num(r.digg_count) ?? 0;
  const comments = num(r.comment_count);
  const shares = num(r.share_count);
  const days = Math.round(num(r.put_days) ?? 0);
  const spend = num(r.min_cpm); // PiPiSpy's own minimum ad-spend estimate, USD
  const lastPut = num(r.last_put_time) ?? num(r.modify_time);
  const lastMs = lastPut ? (lastPut < 1e12 ? lastPut * 1000 : lastPut) : undefined;
  const landing = http(first.link_url);
  const tags = Array.isArray(r.ai_analysis_tags) ? (r.ai_analysis_tags as unknown[]).filter((t) => typeof t === "string").join(" ") : "";
  const advertiser = str(r.app_name, 200) || str(r.unique_id, 200) || "Unknown advertiser";

  // Honest 0-100 score from what PiPiSpy measured: run length, reach, engagement, spend.
  const engagement = likes + 2 * (comments ?? 0) + 3 * (shares ?? 0);
  const aiScore = Math.max(1, Math.min(100, Math.round(
    (Math.min(days, 60) / 60) * 35 +
      (Math.min(Math.log10(1 + (plays ?? 0)), 7) / 7) * 30 +
      (Math.min(Math.log10(1 + engagement), 5) / 5) * 20 +
      (Math.min(Math.log10(1 + (spend ?? 0)), 5) / 5) * 15,
  )));

  const lang = str(r.ai_analysis_language, 10).toLowerCase().split("-")[0];

  return {
    externalId: `pipi:${id}`,
    source: "pipispy",
    advertiserName: advertiser,
    platform: PLATFORM[Number(r.platform)] ?? "Facebook",
    country,
    niche: classifyNiche({ title: headline, body: `${desc} ${tags}`, url: landing, advertiser }, opts.fallbackNiche),
    headline,
    bodyText: desc.slice(0, 2000),
    creativeUrl: creative,
    landingPageUrl: landing,
    spendEstimate: spend ? `${money(spend)}+ (PiPiSpy est.)` : "Unknown",
    likes,
    views: plays ? compact(plays) : "0",
    daysRunning: days,
    aiScore,
    firstSeenAt: iso(r.found_time) ?? iso(r.ad_create_time) ?? new Date(nowMs).toISOString(),
    mediaType: carousel.length > 1 ? "carousel" : Number(r.type) === 2 ? "image" : video ? "video" : "image",
    ...(video ? { videoUrl: video } : {}),
    ...(http(r.app_image) ? { advertiserAvatar: http(r.app_image) } : {}),
    ...(str(r.button_text) ? { ctaText: str(r.button_text, 60) } : {}),
    ...(plays !== undefined ? { impressions: plays } : {}),
    ...(comments !== undefined ? { comments } : {}),
    ...(shares !== undefined ? { shares } : {}),
    ...(lastMs ? { lastSeenAt: new Date(lastMs).toISOString(), isActive: nowMs - lastMs < 3 * 86_400_000 } : {}),
    ...(countries.length ? { countries } : {}),
    ...(lang && /^[a-z]{2}$/.test(lang) ? { language: lang } : {}),
  };
}
