// Screenshots the browser sends to the AI (Launch → "Match a screenshot", Screenshot to page): the page shrinks
// and cuts them into parts first (src/lib/screenshotParts.ts); this checks what arrives. Pure.

export const MAX_SCREENSHOT_PARTS = 6;
export const MAX_PART_BYTES = 4_000_000; // base64 length of one part

export type ScreenshotPart = { data: string; mediaType: string };

/** Screenshots taken from a link per day, by tier (lib/billing.ts byTier): each is one Apify run (about $0.003). */
export const LINK_SHOTS = { admin: 300, paid: 60, trial: 10, free: 4 } as const;
/** Bigger screenshots (very long pages) don't fit in the answer to the browser. */
export const MAX_SHOT_BYTES = 7_000_000;

/**
 * What apify/screenshot-url is asked: the whole page at desktop width. It starts once the page is there
 * ("load" waits for every tracker and can hang past the time limit, customlove.se did) and scrolls down
 * with pauses so lazy images load.
 */
export function shotInput(url: string) {
  return {
    urls: [{ url }],
    format: "png",
    waitUntil: "domcontentloaded",
    delay: 2500,
    viewportWidth: 1280,
    scrollToBottom: true,
    delayAfterScrolling: 2500,
    proxy: { useApifyProxy: true },
  };
}

/** Why these parts can't go to the AI, or null when they can. */
export function screenshotProblem(parts: ScreenshotPart[]): string | null {
  if (!parts.length) return "Add a screenshot first.";
  if (parts.length > MAX_SCREENSHOT_PARTS) return `Use at most ${MAX_SCREENSHOT_PARTS} screenshot parts.`;
  for (const p of parts) {
    if (!/^image\/(jpeg|png|webp)$/.test(p.mediaType)) return "Use a JPG, PNG or WebP screenshot.";
    if (!p.data || p.data.length > MAX_PART_BYTES) return "That screenshot is too large. Try a smaller one.";
  }
  return null;
}

/** What the AI is told about how the parts fit together. */
export function partsNote(count: number): string {
  return count > 1 ? `The screenshot comes in ${count} parts, top to bottom, of one long page.` : "";
}
