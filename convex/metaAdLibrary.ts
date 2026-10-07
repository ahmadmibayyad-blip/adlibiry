import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { META_FIELDS, META_SEARCH_TERMS, describeMetaError, metaAdToExternal, metaCountries, type MetaApiError, type MetaArchiveAd } from "./lib/metaAdLibrary";

// Daily import from Meta's official Ad Library API (crons.ts → importRuns
// "metaAdLibrary"). Needs a Meta app access token with Ad Library API access
// (identity-verified developer account): Convex env META_ACCESS_TOKEN.
// Countries: META_AD_COUNTRIES (EU/UK only, default DK,SE,DE,NL,FR); others
// are skipped with a note, since the API has no commercial ads there.
// One page of active ads per niche per country.

const PER_PAGE = 50;
const RETRY_AFTER_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MetaReply = { data?: MetaArchiveAd[]; error?: MetaApiError };

/** One ads_archive request; on throttling waits and tries once more. */
async function archive(token: string, params: Record<string, string>): Promise<{ ads: MetaArchiveAd[] } | { error: string; stop: boolean }> {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/ads_archive`);
  for (const [k, val] of Object.entries({ ad_active_status: "ACTIVE", ad_type: "ALL", fields: META_FIELDS, ...params })) url.searchParams.set(k, val);
  for (let attempt = 0; attempt < 2; attempt++) {
    // The token goes in a header, not the URL, so it never lands in logs.
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as MetaReply;
    if (res.ok && Array.isArray(body.data)) return { ads: body.data };
    const problem = describeMetaError(body.error, res.status);
    if (problem.retry && attempt === 0) {
      await sleep(RETRY_AFTER_MS);
      continue;
    }
    return { error: problem.message, stop: problem.stop };
  }
  return { error: "Meta API: no answer", stop: false };
}

export const dailyImport = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notConfigured: string } | { fetched: number; created: number; updated: number; errors: string[] }> => {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    if (!token) return { notConfigured: "META_ACCESS_TOKEN isn't set (Meta Ad Library API)" };
    const { use: countries, skipped } = metaCountries(process.env.META_AD_COUNTRIES ?? process.env.META_ADS_COUNTRIES);
    const out = { fetched: 0, created: 0, updated: 0, errors: [] as string[] };
    if (skipped.length) out.errors.push(`Skipped ${skipped.join(", ")}: Meta's API only has commercial ads for EU countries and the UK.`);
    if (!countries.length) return out;
    const now = Date.now();
    for (const country of countries) {
      for (const [niche, terms] of Object.entries(META_SEARCH_TERMS)) {
        try {
          const r = await archive(token, { search_terms: terms, ad_reached_countries: JSON.stringify([country]), limit: String(PER_PAGE) });
          if ("error" in r) {
            // A bad token or missing access fails every call the same way: say it once and stop.
            if (r.stop) {
              out.errors.unshift(r.error);
              return out;
            }
            out.errors.push(`${country} ${niche}: ${r.error}`);
            continue;
          }
          out.fetched += r.ads.length;
          const ads = r.ads.map((a) => metaAdToExternal(a, country, niche, now));
          const saved = await ctx.runMutation(internal.sources.links.upsertExternalAds, { ads });
          out.created += saved.created;
          out.updated += saved.updated;
          out.errors.push(...saved.errors);
        } catch (e) {
          out.errors.push(`${country} ${niche}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return out;
  },
});

/**
 * One targeted search (fusion.ts trigger C: a marketplace product with no ads
 * yet). Free and official; null when META_ACCESS_TOKEN isn't set.
 */
export async function searchMetaAds(terms: string, countries: string[]): Promise<{ ads: MetaArchiveAd[] } | { error: string; stop?: boolean } | null> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return null;
  try {
    return await archive(token, { search_terms: terms, search_type: "KEYWORD_EXACT_PHRASE", ad_reached_countries: JSON.stringify(countries), limit: "25" });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
