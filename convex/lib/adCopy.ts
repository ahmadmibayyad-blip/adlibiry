// Ad copy as people should read it. Scraped bodies often carry metadata from
// the source page ("Button: Shop Now", "Link: …", "Library ID: …", "Sponsored")
// mixed into the text. cleanAdCopy strips it and returns the call-to-action
// it found, so the CTA can be stored in its own field (ads.ctaText).

const META_KEY =
  /^\s*(button|cta|call[ -]to[ -]action|link|landing page|url|website|display link|ad id|library id|ad library id|started running(?: on)?|platforms?|status)\s*[:：]\s*(.*)$/i;
const CTA_KEYS = /^(button|cta|call[ -]to[ -]action)$/i;
const NOISE = /^\s*(sponsored|see ad details|see summary details|active|inactive|ad details)\s*$/i;

export function cleanAdCopy(text: string): { text: string; cta?: string } {
  if (!text) return { text: "" };
  let cta: string | undefined;
  const keep = (segment: string): boolean => {
    if (NOISE.test(segment)) return false;
    const m = segment.match(META_KEY);
    if (!m) return true;
    if (CTA_KEYS.test(m[1].trim()) && m[2].trim() && !cta) cta = m[2].trim().slice(0, 40);
    return false;
  };
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/\s+·\s+/)
        .filter(keep)
        .join(" · ")
        // "…great deal! Button: Shop Now" at the end of a sentence.
        .replace(/\s*\b(?:button|cta|call to action)\s*:\s*([^\n·|]{1,40})$/i, (_, c: string) => {
          cta ??= c.trim();
          return "";
        })
        .trimEnd(),
    );
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, cta };
}
