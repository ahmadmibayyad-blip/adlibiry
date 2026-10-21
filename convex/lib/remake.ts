// Remake this winner (convex/remake.ts): after "Write my version" has written a
// script, an AI actor speaks it and AI product shots are cut in, as one 9:16
// MP4. Each voiced script line is one segment: the actor (fal OmniHuman, lip-
// synced to that line's ElevenLabs audio) or the product (fal Seedance, from
// the user's photo). fal's ffmpeg compose lays them end to end. Users get
// REMAKE_SECONDS of AI video a month and can buy REMAKE_PACK extra seconds.
// Pure parts, tested in remake.test.ts.

import { tierOf, type PlanUser, type Tier } from "./billing";

// Synthetic, AI-generated people (public/actors/<id>.jpg), never real faces.
export const REMAKE_ACTORS: { id: string; name: string; gender: "female" | "male" }[] = [
  { id: "maya", name: "Maya", gender: "female" },
  { id: "sofia", name: "Sofia", gender: "female" },
  { id: "emma", name: "Emma", gender: "female" },
  { id: "aisha", name: "Aisha", gender: "female" },
  { id: "liam", name: "Liam", gender: "male" },
  { id: "noah", name: "Noah", gender: "male" },
  { id: "omar", name: "Omar", gender: "male" },
  { id: "lucas", name: "Lucas", gender: "male" },
];

export const MAX_LINES = 12;
export const MAX_SECONDS = 45;
export const MAX_PRODUCT_SHOTS = 2;
export const STALE_MS = 20 * 60_000;
export const POLL_MS = 10_000;
// Whether fal's compose keeps a video clip's own sound. Until checked on fal
// (plan Task 1), every line's audio goes on the voice track.
export const COMPOSE_KEEPS_VIDEO_AUDIO = false;

// AI-video seconds a month per tier (Pro is the paid plan); null = unlimited.
export const REMAKE_SECONDS: Record<Tier, number | null> = { admin: null, paid: 60, trial: 15, free: 0 };
export const REMAKE_PACK = { seconds: 30, cents: 900 };

export type SegmentKind = "actor" | "product";
export type Segment = {
  kind: SegmentKind;
  text: string;
  scene: string;
  audioId?: string;
  audioUrl?: string;
  audioSeconds?: number;
  statusUrl?: string;
  responseUrl?: string;
  videoUrl?: string;
};

const PRODUCT_SCENE = /product|close-?up|unbox|demo|hands?|b-?roll|packag|show(s|ing)? (it|the)/i;
const WORDS_PER_SECOND = 2.5;

/** The script's voiced lines as segments: the first on the actor, product scenes (at most 2) as product shots. */
export function planShots(lines: { scene: string; voiceover: string }[]): Segment[] {
  const out: Segment[] = [];
  let products = 0;
  for (const l of lines) {
    const text = l.voiceover.trim();
    if (!text) continue;
    const scene = l.scene.trim();
    const product = out.length > 0 && products < MAX_PRODUCT_SHOTS && PRODUCT_SCENE.test(scene);
    if (product) products++;
    out.push({ kind: product ? "product" : "actor", text, scene });
  }
  return out;
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Seconds the script takes to say, before it's voiced. */
export function estimateSeconds(lines: { voiceover: string }[]): number {
  let total = 0;
  for (const l of lines) {
    const words = wordCount(l.voiceover);
    if (words) total += Math.max(1, words / WORDS_PER_SECOND);
  }
  return Math.ceil(total);
}

/** Length of an ElevenLabs mp3_44100_128 file (constant bit rate). */
export function mp3Seconds(bytes: number): number {
  return Math.round(((bytes * 8) / 128_000) * 100) / 100;
}

/** Seedance's duration for a line of this length: whole seconds, 2–12. */
export function seedanceDuration(seconds: number): string {
  return String(Math.min(12, Math.max(2, Math.ceil(seconds))));
}

export function productPrompt(scene: string, product: string): string {
  return `${scene.trim()}. The product: ${product.trim()}. Vertical phone video, natural light, realistic, no text on screen.`.slice(0, 600);
}

const count = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** The user's AI-video seconds this month (null = unlimited); REMAKE_SECONDS_<TIER> overrides. */
export function remakeSecondsLimit(user: PlanUser | null, env: Record<string, string | undefined>): number | null {
  const tier = tierOf(user);
  if (tier === "admin") return null;
  return count(env[`REMAKE_SECONDS_${tier.toUpperCase()}`]) ?? REMAKE_SECONDS[tier];
}

export function monthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** The extra-seconds pack (REMAKE_PACK_SECONDS / REMAKE_PACK_CENTS override). */
export function remakePack(env: Record<string, string | undefined>): { seconds: number; cents: number } {
  const positive = (v: string | undefined, fallback: number) => {
    const n = count(v);
    return n !== null && n > 0 ? n : fallback;
  };
  return { seconds: positive(env.REMAKE_PACK_SECONDS, REMAKE_PACK.seconds), cents: positive(env.REMAKE_PACK_CENTS, REMAKE_PACK.cents) };
}

/** How a remake of `need` seconds is paid: this month's seconds first, then bought ones; null when short. */
export function splitCharge(need: number, monthlyLeft: number | null, extraLeft: number): { monthly: number; extra: number } | null {
  if (monthlyLeft === null) return { monthly: need, extra: 0 };
  const monthly = Math.min(need, Math.max(0, monthlyLeft));
  const extra = need - monthly;
  return extra <= Math.max(0, extraLeft) ? { monthly, extra } : null;
}

type Track = { id: string; type: "video" | "audio"; keyframes: { url: string; timestamp: number; duration: number }[] };

/** fal compose tracks: the clips end to end, and each line's voice at its clip's start. */
export function composeTracks(segments: Segment[], keepVideoAudio: boolean): Track[] {
  const video: Track = { id: "video", type: "video", keyframes: [] };
  const voice: Track = { id: "voice", type: "audio", keyframes: [] };
  let at = 0;
  for (const s of segments) {
    const duration = Math.round((s.audioSeconds ?? 0) * 1000);
    video.keyframes.push({ url: s.videoUrl ?? "", timestamp: at, duration });
    if (!(keepVideoAudio && s.kind === "actor")) voice.keyframes.push({ url: s.audioUrl ?? "", timestamp: at, duration });
    at += duration;
  }
  return [video, voice];
}
