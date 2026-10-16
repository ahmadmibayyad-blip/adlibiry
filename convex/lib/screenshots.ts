// Screenshots the browser sends to the AI (Launch → "Match a screenshot", Screenshot to page): the page shrinks
// and cuts them into parts first (src/lib/screenshotParts.ts); this checks what arrives. Pure.

export const MAX_SCREENSHOT_PARTS = 6;
export const MAX_PART_BYTES = 4_000_000; // base64 length of one part

export type ScreenshotPart = { data: string; mediaType: string };

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
