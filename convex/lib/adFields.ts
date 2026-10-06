import { v } from "convex/values";

// Optional rich ad fields shared by every importer (AdLibrary, Apify,
// Nexscope, extension). Mirrors the optional part of the `ads` table.
export const richAdFields = {
  externalKey: v.optional(v.string()),
  mediaType: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  advertiserAvatar: v.optional(v.string()),
  ctaText: v.optional(v.string()),
  impressions: v.optional(v.number()),
  comments: v.optional(v.number()),
  shares: v.optional(v.number()),
  lastSeenAt: v.optional(v.string()),
  isActive: v.optional(v.boolean()),
  countries: v.optional(v.array(v.string())),
  relatedAdsCount: v.optional(v.number()),
  language: v.optional(v.string()),
  adLibraryUrl: v.optional(v.string()),
  gmv: v.optional(v.number()),
  audience: v.optional(
    v.object({
      totalReach: v.optional(v.number()),
      malePct: v.optional(v.number()),
      femalePct: v.optional(v.number()),
      ages: v.array(v.object({ bracket: v.string(), pct: v.number() })),
      countries: v.array(v.object({ code: v.string(), pct: v.number() })),
    }),
  ),
};

// Drop undefined keys so patches never erase data with "undefined".
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined && val !== null && val !== "")) as Partial<T>;
}

export const numOrUndef = (x: unknown): number | undefined => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x.replace(/[^0-9.\-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
