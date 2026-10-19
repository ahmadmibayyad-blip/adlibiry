// Convex retries a mutation a few times when another one changes the same documents meanwhile, then gives up with
// "Documents read from or written to the "x" table changed while this mutation was being run and on every
// subsequent retry". Imports that run at the same moment (Offer research: 16 countries finish within seconds, and
// the same ad or store often shows up in several of them) hit that; waiting a moment and calling again gets through.

export function isWriteConflict(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /changed while this mutation was being run/i.test(message);
}

/** Calls `fn` again after a short random pause when it fails with a write conflict, up to `tries` times in all. */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  { tries = 5, pause = (attempt: number) => 500 + Math.random() * 1000 * attempt, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !isWriteConflict(e)) throw e;
      await sleep(pause(attempt));
    }
  }
}
