// AI voiceover (convex/voiceover.ts): ElevenLabs reads a video script's
// voice-over lines (ELEVENLABS_API_KEY). The multilingual model speaks the
// script's own language (Danish, Swedish, German…) with any voice.
// Pure parts, tested in voiceover.test.ts.

export const ELEVEN_URL = "https://api.elevenlabs.io/v1";
export const ELEVEN_MODEL = "eleven_multilingual_v2";
export const ELEVEN_FORMAT = "mp3_44100_128";
// Voiceovers a user may make per day; ElevenLabs bills by character.
export const VOICEOVER_RUNS = { admin: 100, paid: 20, trial: 3, free: 1 } as const;
export const MAX_VOICE_CHARS = 1500; // about 90 seconds of speech
export const KEPT_PER_USER = 20; // older MP3s are deleted from storage

export type VoiceOption = { id: string; name: string; gender?: string; accent?: string; preview?: string };

/** The voice-over lines of a script, one per line, ready to read out. */
export function voiceText(lines: { voiceover: string }[]): string {
  return lines
    .map((l) => l.voiceover.trim())
    .filter(Boolean)
    .join("\n");
}

/** ElevenLabs' GET /v1/voices reply as a short list (premade voices first, then the account's own). */
export function readVoices(body: unknown): VoiceOption[] {
  const voices = (body as { voices?: unknown[] } | null)?.voices;
  if (!Array.isArray(voices)) return [];
  const out: (VoiceOption & { own: boolean })[] = [];
  for (const raw of voices) {
    const v = (raw ?? {}) as { voice_id?: unknown; name?: unknown; category?: unknown; preview_url?: unknown; labels?: Record<string, unknown> };
    if (typeof v.voice_id !== "string" || typeof v.name !== "string") continue;
    const label = (k: string) => (typeof v.labels?.[k] === "string" ? (v.labels[k] as string) : undefined);
    out.push({
      id: v.voice_id,
      name: v.name.slice(0, 60),
      gender: label("gender"),
      accent: label("accent"),
      preview: typeof v.preview_url === "string" ? v.preview_url : undefined,
      own: v.category !== "premade",
    });
  }
  return out
    .sort((a, b) => Number(a.own) - Number(b.own) || a.name.localeCompare(b.name))
    .slice(0, 60)
    .map(({ own: _own, ...v }) => v);
}

/** An ElevenLabs error in the user's words; admins also see ElevenLabs' own message. */
export function describeElevenError(status: number, body: unknown, admin: boolean): string {
  const detail = (body as { detail?: { message?: unknown; status?: unknown } | string } | null)?.detail;
  const msg = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : "";
  const extra = admin && msg ? ` (ElevenLabs: ${msg.slice(0, 160)})` : "";
  if (status === 401) return `The voice service refused the key. Check ELEVENLABS_API_KEY in Convex.${extra}`;
  if (status === 402 || /quota|credits/i.test(msg)) return `The voice service is out of credits for this month.${extra}`;
  if (status === 429) return `The voice service is busy. Try again in a minute.${extra}`;
  if (status === 422 || status === 400) return `The voice service couldn't read that script.${extra}`;
  return `The voiceover failed. Try again.${extra}`;
}
