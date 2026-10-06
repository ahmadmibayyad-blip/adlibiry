import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { META_FIELDS, META_SEARCH_TERMS, metaAdToExternal, type MetaArchiveAd } from "./lib/metaAdLibrary";

// Daily import from Meta's official Ad Library API (crons.ts → importRuns
// "metaAdLibrary"). Needs a Meta app access token with Ad Library API access
// (identity-verified developer account): Convex env META_ACCESS_TOKEN.
// Countries: META_AD_COUNTRIES (EU only, default DK,SE,DE,NL,FR).
// One page of active ads per niche per country.

const PER_PAGE = 50;

export const dailyImport = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; created: number; updated: number; errors: string[] }> => {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    if (!token) return { notConfigured: "META_ACCESS_TOKEN isn't set (Meta Ad Library API)" };
    const version = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
    const countries = (process.env.META_AD_COUNTRIES ?? "DK,SE,DE,NL,FR").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    const out = { fetched: 0, created: 0, updated: 0, errors: [] as string[] };
    const now = Date.now();
    for (const country of countries) {
      for (const [niche, terms] of Object.entries(META_SEARCH_TERMS)) {
        const url = new URL(`https://graph.facebook.com/${version}/ads_archive`);
        url.searchParams.set("search_terms", terms);
        url.searchParams.set("ad_reached_countries", JSON.stringify([country]));
        url.searchParams.set("ad_active_status", "ACTIVE");
        url.searchParams.set("ad_type", "ALL");
        url.searchParams.set("fields", META_FIELDS);
        url.searchParams.set("limit", String(PER_PAGE));
        try {
          // The token goes in a header, not the URL, so it never lands in logs.
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
          const body = (await res.json()) as { data?: MetaArchiveAd[]; error?: { message?: string } };
          if (!res.ok || !Array.isArray(body.data)) {
            out.errors.push(`${country} ${niche}: ${body.error?.message ?? `HTTP ${res.status}`}`);
            continue;
          }
          out.fetched += body.data.length;
          const ads = body.data.map((a) => metaAdToExternal(a, country, niche, now));
          const r = await ctx.runMutation(internal.sources.links.upsertExternalAds, { ads });
          out.created += r.created;
          out.updated += r.updated;
          out.errors.push(...r.errors);
        } catch (e) {
          out.errors.push(`${country} ${niche}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return out;
  },
});
