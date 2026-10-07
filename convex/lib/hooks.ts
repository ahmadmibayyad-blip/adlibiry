import { parseCompact } from "./productMatch";

// Hooks of the week: pure helpers (convex/hooks.ts runs them).
// A hook is the ad's opening line: TikTok ads carry it in the title, Meta ads
// in the first sentence of the ad text.

export const HOOKS_PER_NICHE = 8;

export const HOOK_TYPES = [
  "Question",
  "POV / story",
  "Problem → solution",
  "Before / after",
  "This vs that",
  "Social proof",
  "Shock / curiosity",
  "Offer / urgency",
  "Demo / how-to",
  "Other",
] as const;

type HookAd = { headline: string; bodyText: string; views: string; impressions?: number; likes: number; comments?: number; shares?: number; spokenHook?: string };

const GENERIC = /^(tiktok ad|facebook ad|instagram ad|sponsored|shop now|learn more|untitled)$/i;

const firstSentence = (s: string) => {
  const line = s.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const m = line.match(/^(.{12,160}?[.!?…])(\s|$)/);
  return (m ? m[1] : line).slice(0, 160).trim();
};

// The opening line of the ad, or null when there's nothing usable.
export function hookText(ad: HookAd): string | null {
  // A video's spoken opening line (its transcript) is the real hook when we have it.
  if (ad.spokenHook && ad.spokenHook.length >= 12) return ad.spokenHook;
  const body = ad.bodyText.trim();
  const fromBody = body && !/^GMV\b/i.test(body) ? firstSentence(body) : "";
  const headline = ad.headline.trim();
  const candidates = [fromBody, headline].filter((t) => t.length >= 12 && !GENERIC.test(t) && /[a-z]/i.test(t));
  return candidates[0] ? candidates[0].replace(/\s+/g, " ") : null;
}

export function engagement(ad: HookAd): number {
  const views = ad.impressions ?? parseCompact(ad.views) ?? 0;
  return views + ad.likes * 20 + (ad.comments ?? 0) * 50 + (ad.shares ?? 0) * 50;
}

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);

// Best ads first, one per hook text (the same hook often runs in many copies).
export function pickHooks<T extends HookAd>(ads: T[], n = HOOKS_PER_NICHE): { ad: T; hook: string; score: number }[] {
  const seen = new Set<string>();
  const out: { ad: T; hook: string; score: number }[] = [];
  for (const ad of [...ads].sort((a, b) => engagement(b) - engagement(a))) {
    const hook = hookText(ad);
    if (!hook || seen.has(key(hook))) continue;
    seen.add(key(hook));
    out.push({ ad, hook, score: engagement(ad) });
    if (out.length >= n) break;
  }
  return out;
}

// ISO week label, e.g. "2026-W40" (weeks start on Monday).
export function isoWeek(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Angles per niche (roadmap P2-B) ─────────────────────────────────────────
// From the hook types Claude gave the niche's winning hooks over recent weeks:
// the share of each angle, the crowded one (40%+ of hooks) and the unclaimed
// ones (no winning hook uses them yet).
export type AngleSummary = { shares: { type: string; share: number }[]; crowded?: { type: string; share: number }; unclaimed: string[] };

export function angleSummary(types: (string | undefined)[]): AngleSummary | null {
  const labelled = types.filter((t): t is string => !!t && t !== "Other");
  if (labelled.length < 5) return null; // too few to say anything
  const counts = new Map<string, number>();
  for (const t of labelled) counts.set(t, (counts.get(t) ?? 0) + 1);
  const shares = [...counts].map(([type, n]) => ({ type, share: Math.round((n / labelled.length) * 100) / 100 })).sort((a, b) => b.share - a.share);
  return {
    shares,
    ...(shares[0].share >= 0.4 ? { crowded: shares[0] } : {}),
    unclaimed: HOOK_TYPES.filter((t) => t !== "Other" && !counts.has(t)),
  };
}

// ── Spoken hooks from video transcripts ─────────────────────────────────────
export type TranscriptWord = { word: string; punctuated_word?: string; start: number; end: number };

// The opening line of a video: the words spoken in its first 3 seconds, run on
// to the end of that sentence (up to 6 seconds). Null when nothing is said.
export function spokenHook(words: TranscriptWord[]): string | null {
  const out: string[] = [];
  for (const w of words) {
    if (w.start >= 6 || (w.start >= 3 && /[.!?]$/.test(out[out.length - 1] ?? ""))) break;
    out.push(w.punctuated_word ?? w.word);
  }
  const line = out.join(" ").replace(/\s+/g, " ").trim();
  return line.length >= 8 ? line.slice(0, 160) : null;
}
