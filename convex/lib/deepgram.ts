// Deepgram pre-recorded speech-to-text, shared by the daily transcripts job and
// "Transcribe video" on the ad page (convex/transcripts.ts). Pure: the callers fetch.
import { spokenHook, type TranscriptWord } from "./hooks";

export const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true";

// "Transcribe video" a day per user; a video already transcribed doesn't count.
export const TRANSCRIBE_RUNS = { admin: 300, paid: 40, trial: 10, free: 3 } as const;

export type DeepgramBody = {
  results?: { channels?: { alternatives?: { transcript?: string; words?: TranscriptWord[] }[] }[] };
  err_msg?: string;
};

/** The transcript and spoken hook from Deepgram's answer; empty when nothing is said. */
export function readDeepgram(body: DeepgramBody | null): { transcript?: string; hook?: string } {
  const alt = body?.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alt?.transcript?.trim() || undefined;
  const hook = (alt?.words ? spokenHook(alt.words) : null) ?? undefined;
  return { ...(transcript ? { transcript } : {}), ...(hook ? { hook } : {}) };
}
