// Winning Products mix: every WINNERS_ROUND_DAYS a new mix is drawn from the
// products we already have. Per niche the best WINNERS_TOP_KEEP by score
// always stay; the rest of the slots rotate, preferring products that weren't
// in the last round. Pure (seeded by the round's day), so it's unit-tested.

export const WINNERS_ROUND_DAYS = 3;
export const WINNERS_TOP_KEEP = 25;

// Small seeded PRNG (mulberry32 over a string hash): the same round always
// draws the same mix, so a re-run on the same day doesn't reshuffle.
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One niche's picks for a round. `ranked` is every qualifying product, best
 * score first; `previous` holds the ids that were winners last round.
 * Returns at most `slots` products, best score first.
 */
export function pickNicheMix<T extends { _id: string; aiScore: number }>(
  ranked: T[],
  previous: Set<string>,
  seed: string,
  slots: number,
  keepTop = WINNERS_TOP_KEEP,
): T[] {
  if (ranked.length <= slots) return ranked;
  const top = ranked.slice(0, Math.min(keepTop, slots));
  const rest = ranked.slice(top.length);
  const rnd = seededRandom(seed);
  const fresh = shuffle(rest.filter((p) => !previous.has(p._id)), rnd);
  const shown = shuffle(rest.filter((p) => previous.has(p._id)), rnd);
  const picks = [...fresh, ...shown].slice(0, slots - top.length);
  return [...top, ...picks].sort((a, b) => b.aiScore - a.aiScore);
}

/** Whole days from `from` to `to` ("YYYY-MM-DD"). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
