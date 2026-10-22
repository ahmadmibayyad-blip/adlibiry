// Affiliate links (adspypro.net/r/<code>, convex/affiliates.ts): the browser
// keeps the code for 60 days, and the dashboard hands it to claimReferral after
// sign-up. The last link opened wins. localStorage can throw (private mode,
// blocked storage); a lost code only means no commission.

const KEY = "adspy-ref";
const CLICKED = "adspy-ref-clicked";
export const REFERRAL_DAYS = 60;
const MAX_AGE = REFERRAL_DAYS * 24 * 60 * 60 * 1000;

type Saved = { code: string; at: number };

export function saveReferral(code: string, now = Date.now()): void {
  const clean = code.trim().toLowerCase().slice(0, 40);
  if (!clean) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: clean, at: now } satisfies Saved));
  } catch {
    // no commission for this visit
  }
}

/** The saved code, if it's younger than 60 days. */
export function pendingReferral(now = Date.now()): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    if (!saved || typeof saved.code !== "string" || typeof saved.at !== "number") return null;
    return now - saved.at <= MAX_AGE ? saved.code : null;
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** True the first time this browser opens this code's link (one click each). */
export function firstClick(code: string): boolean {
  try {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(CLICKED) ?? "[]"));
    if (seen.has(code)) return false;
    seen.add(code);
    localStorage.setItem(CLICKED, JSON.stringify([...seen].slice(-20)));
    return true;
  } catch {
    return true;
  }
}
