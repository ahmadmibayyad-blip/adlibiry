// A store's theme, apps and tracking pixels, kept on its `stores` row so the
// Stores page can filter on them (like Minea's Shopify theme / app filters).
// Read from its home page by the daily storeTech job, or copied from a Store
// Inspector run (lib/storeInspect.ts Inspection).
import type { Inspection } from "./storeInspect";

export type StoreTech = {
  checkedAt: string; // ISO 8601 UTC
  ok: boolean; // false: the home page couldn't be read or isn't Shopify
  theme?: string; // e.g. "Dawn", "Impulse"
  apps: string[]; // app names, e.g. "Kaching Bundles"
  pixels: string[]; // e.g. "Meta", "TikTok"
};

export const TECH_MAX_APPS = 40;

export function storeTechFrom(result: Inspection | null | undefined, checkedAt: string): StoreTech {
  if (!result || !result.shopify) return { checkedAt, ok: false, apps: [], pixels: [] };
  const theme = (result.theme?.schemaName || result.theme?.name || "").trim();
  return {
    checkedAt,
    ok: true,
    ...(theme ? { theme } : {}),
    apps: [...new Set((result.apps ?? []).map((a) => a.name.trim()).filter(Boolean))].slice(0, TECH_MAX_APPS),
    pixels: [...new Set((result.pixels ?? []).map((p) => p.trim()).filter(Boolean))],
  };
}

export type TechFilter = { theme?: string; app?: string; pixel?: string };

export function hasTechFilter(f: TechFilter): boolean {
  return !!(f.theme || f.app || f.pixel);
}

// Stores never read (no tech) don't match a tech filter.
export function matchesTech(tech: StoreTech | undefined, f: TechFilter): boolean {
  if (!hasTechFilter(f)) return true;
  if (!tech?.ok) return false;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (f.theme && !(tech.theme && same(tech.theme, f.theme))) return false;
  if (f.app && !tech.apps.some((a) => same(a, f.app!))) return false;
  if (f.pixel && !tech.pixels.some((p) => same(p, f.pixel!))) return false;
  return true;
}

type Count = { value: string; n: number };
const top = (m: Map<string, number>, limit: number): Count[] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value, n]) => ({ value, n }));

// What the filter dropdowns offer: the themes, apps and pixels seen, most common first.
export function techFacets(techs: (StoreTech | undefined)[]) {
  const themes = new Map<string, number>();
  const apps = new Map<string, number>();
  const pixels = new Map<string, number>();
  let read = 0;
  for (const t of techs) {
    if (!t?.ok) continue;
    read++;
    if (t.theme) themes.set(t.theme, (themes.get(t.theme) ?? 0) + 1);
    for (const a of t.apps) apps.set(a, (apps.get(a) ?? 0) + 1);
    for (const p of t.pixels) pixels.set(p, (pixels.get(p) ?? 0) + 1);
  }
  return { read, themes: top(themes, 40), apps: top(apps, 60), pixels: top(pixels, 20) };
}

// The store's address without www, for matching an inspection to its row.
export function hostOf(url: string): string | undefined {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
