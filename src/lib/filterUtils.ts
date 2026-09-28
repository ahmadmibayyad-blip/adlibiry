// Helpers for the filter panels (see src/components/filters.tsx).

export const opt = (value: string, label: string) => ({ value, label });
export const ANY = opt("any", "Any");

// "min-max" → { min, max } ("1000-" = at least 1000, "0-10" = up to 10).
export function range(value: string | undefined): { min?: number; max?: number } {
  if (!value) return {};
  const [a, b] = value.split("-");
  const n = (s: string | undefined) => (s && Number.isFinite(Number(s)) ? Number(s) : undefined);
  return { min: n(a), max: n(b) };
}

// localStorage can throw (private mode, blocked storage) — never let it break the page.
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // the feature just doesn't persist
  }
}
