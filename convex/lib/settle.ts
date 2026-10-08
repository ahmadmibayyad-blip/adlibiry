// For tests: waits for convex-test's scheduled functions on a slow machine.
// finishAllScheduledFunctions gives a running action a fixed number of event
// loop turns, not time, so a launch (crypto, Blobs, several fetches) can run out
// of turns when the whole suite runs at once. Its work keeps going, so this
// waits a moment and asks again; real errors still fail the test.

type WithScheduler = { finishAllScheduledFunctions: (advanceTimers: () => void) => Promise<void> };

export async function settle(t: WithScheduler, tries = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await t.finishAllScheduledFunctions(() => {});
    } catch (e) {
      if (i >= tries || !/timer pumps/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
