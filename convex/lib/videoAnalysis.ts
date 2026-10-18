// Video ad analysis (convex/videoAnalysis.ts): Apify's tubetext/video-ad-analyzer
// watches the ad's video (sampled frames + speech) and answers with the hook,
// angle, offer, beat-by-beat structure and a shot list. About $0.05 and a
// minute per ad. readAnalysis keeps the parts the ad page shows; the variant
// script (videoAnalysisAi.ts) is Claude rewriting that structure for the
// user's own product. Pure parts, tested in videoAnalysis.test.ts.

export const ANALYZER_ACTOR = "tubetext~video-ad-analyzer";
export const MAX_VIDEO_MINUTES = 3;
// Analyses a user may start per day; done ones are kept on the ad for everyone.
export const ANALYZE_RUNS = { admin: 100, paid: 15, trial: 3, free: 1 } as const;
// All users together per day (~$0.05 each), VIDEO_ANALYSES_PER_DAY overrides.
export const DEFAULT_DAILY_ANALYSES = 100;
// A "running" analysis older than this is treated as lost (the Apify call takes ~1–2 min).
export const RUNNING_STALE_MS = 6 * 60_000;

export type Beat = { beat: string; start: number; end: number; description: string };
export type Shot = { start: number; end: number; shot: string; scene: string; action: string; onScreenText: string; spoken: string };
export type Analysis = {
  summary: string;
  durationSeconds: number | null;
  hook: { text: string; type: string; why: string } | null;
  angle: string;
  offer: string;
  audience: string;
  tone: string;
  whyItWorks: string;
  cta: { text: string; time: number | null } | null;
  structure: Beat[];
  shots: Shot[];
  pacing: { cuts: number; avgShotSeconds: number | null } | null;
  painPoints: string[];
  benefits: string[];
  socialProof: string[];
  suggestions: string[];
  editingNotes: string;
};

const str = (x: unknown, max = 600): string => (typeof x === "string" ? x.trim().slice(0, max) : "");
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const strs = (x: unknown, n = 8): string[] => (Array.isArray(x) ? x.map((s) => str(s, 300)).filter(Boolean).slice(0, n) : []);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The analyzer's dataset row as an Analysis, or null when it holds no analysis. */
export function readAnalysis(row: unknown): Analysis | null {
  const r = obj(row);
  const structure: Beat[] = (Array.isArray(r.structure) ? r.structure : [])
    .map((b) => obj(b))
    .map((b) => ({ beat: str(b.beat, 40), start: num(b.start) ?? 0, end: num(b.end) ?? 0, description: str(b.description, 300) }))
    .filter((b) => b.beat || b.description)
    .slice(0, 20);
  const shots: Shot[] = (Array.isArray(r.shots) ? r.shots : [])
    .map((s) => obj(s))
    .map((s) => ({
      start: num(s.start) ?? 0,
      end: num(s.end) ?? 0,
      shot: str(s.shot, 40),
      scene: str(s.scene, 200),
      action: str(s.action, 200),
      onScreenText: str(s.on_screen_text, 300),
      spoken: str(s.spoken, 400),
    }))
    .slice(0, 60);
  const summary = str(r.summary, 1200);
  if (!summary && !structure.length && !shots.length) return null;
  const hook = obj(r.hook);
  const cta = obj(r.cta);
  const pacing = obj(r.pacing);
  return {
    summary,
    durationSeconds: num(r.durationSeconds),
    hook: str(hook.text) || str(r.hookText) ? { text: str(hook.text) || str(r.hookText), type: str(hook.type, 40) || str(r.hookType, 40), why: str(hook.why_it_works) } : null,
    angle: str(r.angle, 200),
    offer: str(r.offer, 200),
    audience: str(r.audience, 300),
    tone: str(r.tone, 100),
    whyItWorks: str(r.whyItWorks, 1200),
    cta: str(cta.text) ? { text: str(cta.text), time: num(cta.time) } : null,
    structure,
    shots,
    pacing: typeof pacing.cutCount === "number" ? { cuts: pacing.cutCount, avgShotSeconds: num(pacing.avgShotSeconds) } : null,
    painPoints: strs(r.painPoints),
    benefits: strs(r.benefits),
    socialProof: strs(r.socialProof),
    suggestions: strs(r.suggestions, 6),
    editingNotes: str(r.editingNotes, 800),
  };
}

/** Why a failed analyzer row failed, in the user's words. */
export function analyzerFailure(row: unknown): string {
  const status = str(obj(row).status, 200);
  if (/too long|duration/i.test(status)) return `This video is longer than ${MAX_VIDEO_MINUTES} minutes, so it isn't analysed.`;
  return "We couldn't analyse this video. Its file may have expired; try again later.";
}

// ── Variant script ──────────────────────────────────────────────────────────

export type VariantLine = { start: number; end: number; scene: string; onScreenText: string; voiceover: string };
export type Variant = { title: string; hook: string; lines: VariantLine[]; cta: string; notes: string };

export const VARIANT_SYSTEM =
  "You are a direct-response video ad scriptwriter for e-commerce. You get the breakdown of a video ad that works (its hook, angle, " +
  "beats and shot list) and a product the user sells. Write a new ad for the user's product that keeps the winning ad's structure, " +
  "pacing and kind of hook, but with the user's product, its own benefits and fresh wording: never copy the original's sentences, brand " +
  "or claims. Don't invent prices, discounts, reviews, numbers or guarantees the user didn't give; write a placeholder like [your offer] " +
  "instead. Keep each voice-over line short enough to say in its time slot (about 2.5 words a second). Write in the language asked for.";

/** The prompt for one variant: the analysis, trimmed, and the user's product. */
export function variantPrompt(a: Analysis, product: string, language: string, angle: string): string {
  const beats = a.structure.map((b) => `- ${b.start}–${b.end}s ${b.beat}: ${b.description}`).join("\n");
  const shots = a.shots
    .slice(0, 30)
    .map((s) => `- ${s.start}–${s.end}s [${s.shot}] ${s.scene}; ${s.action}${s.onScreenText ? `; text: "${s.onScreenText}"` : ""}${s.spoken ? `; says: "${s.spoken}"` : ""}`)
    .join("\n");
  return [
    "WINNING AD",
    `Length: ${a.durationSeconds ?? "?"} s`,
    a.hook ? `Hook (${a.hook.type}): ${a.hook.text}\nWhy it works: ${a.hook.why}` : "",
    `Angle: ${a.angle}`,
    a.offer ? `Offer: ${a.offer}` : "",
    a.tone ? `Tone: ${a.tone}` : "",
    `Why it works: ${a.whyItWorks}`,
    beats ? `Beats:\n${beats}` : "",
    shots ? `Shots:\n${shots}` : "",
    "",
    "MY PRODUCT",
    product.trim(),
    angle.trim() ? `\nAngle I want: ${angle.trim()}` : "",
    "",
    `Write the script in ${language}, about as long as the winning ad.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Claude's answer, trimmed and checked, or null when it holds no script. */
export function cleanVariant(raw: unknown): Variant | null {
  const r = obj(raw);
  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .map((l) => obj(l))
    .map((l) => ({
      start: num(l.start) ?? 0,
      end: num(l.end) ?? 0,
      scene: str(l.scene, 300),
      onScreenText: str(l.onScreenText, 300),
      voiceover: str(l.voiceover, 400),
    }))
    .filter((l) => l.scene || l.voiceover || l.onScreenText)
    .slice(0, 40);
  if (!lines.length) return null;
  return { title: str(r.title, 120), hook: str(r.hook, 300), lines, cta: str(r.cta, 300), notes: str(r.notes, 600) };
}

/** The script as plain text, for copying. */
export function variantText(v: Variant): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const body = v.lines.map((l) =>
    [`${fmt(l.start)}–${fmt(l.end)}  ${l.scene}`, l.onScreenText && `  Text: ${l.onScreenText}`, l.voiceover && `  Voice: ${l.voiceover}`].filter(Boolean).join("\n"),
  );
  const head = [v.title, v.hook && `Hook: ${v.hook}`].filter(Boolean).join("\n");
  return [head, body.join("\n"), v.cta && `CTA: ${v.cta}`, v.notes && `Notes: ${v.notes}`].filter(Boolean).join("\n\n");
}
