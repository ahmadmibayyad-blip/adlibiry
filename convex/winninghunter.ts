import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { whToRecords } from "./lib/whTransform";

// WinningHunter REST API (Basic plan+, 1 credit per call, 60 calls/min).
// Key: Convex env WINNINGHUNTER_API_KEY. Daily import markets: WH_COUNTRIES
// (default "DK,SE,NO,DE,GB,US"), pages per market: WH_PAGES (default 2 × 50 ads).
const BASE = "https://app.winninghunter.com/api/v1";

type ImportResult = { calls: number; fetched: number; adsCreated: number; adsUpdated: number; productsCreated: number; productsUpdated: number; errors: string[] };

async function whGet(path: string, params: Record<string, string | number | undefined>) {
  const key = process.env.WINNINGHUNTER_API_KEY;
  if (!key) throw new ConvexError({ code: "NOT_CONFIGURED", message: "Add WINNINGHUNTER_API_KEY in Convex → Settings → Environment Variables" });
  const qs = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) if (val !== undefined && val !== "") qs.set(k, String(val));
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "X-API-Key": key, Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`WinningHunter ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const importArgs = {
  countries: v.string(), // comma-separated ISO2
  keyword: v.optional(v.string()),
  niches: v.optional(v.string()),
  mediafilter: v.optional(v.string()), // videos | images | carousel
  adscorefilter: v.optional(v.string()), // winning | scaling | testing
  sorting: v.optional(v.string()), // lastseen | reach | adspend | mostrecent ...
  pages: v.optional(v.number()),
};

export const importAdLibrary = internalAction({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportResult> => {
    const r: ImportResult = { calls: 0, fetched: 0, adsCreated: 0, adsUpdated: 0, productsCreated: 0, productsUpdated: 0, errors: [] };
    let scroll: string | undefined;
    const pages = Math.max(1, Math.min(args.pages ?? 2, 10));
    for (let page = 0; page < pages; page++) {
      let body: any;
      try {
        body = await whGet("/adlibrary", {
          countries: args.countries,
          keyword: args.keyword,
          niches: args.niches,
          mediafilter: args.mediafilter,
          adscorefilter: args.adscorefilter,
          adstatus: "active",
          sorting: args.sorting ?? "lastseen",
          sortdirection: "desc",
          limit: 50,
          page,
          scroll,
        });
        r.calls++;
      } catch (e) {
        r.errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
      const rows = Array.isArray(body?.data) ? body.data : [];
      if (body?.upgrade) r.errors.push("WinningHunter says this filter needs a higher plan");
      r.fetched += rows.length;
      const markets = args.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
      const { ads, products } = whToRecords(rows, Date.now(), markets);
      for (let i = 0; i < ads.length; i += 25) {
        const res = await ctx.runMutation(internal.admin.externalImport.importAdsInternal, { ads: ads.slice(i, i + 25) });
        r.adsCreated += res.created;
        r.adsUpdated += res.updated;
      }
      if (products.length) {
        const res = await ctx.runMutation(internal.admin.productImport.importProductsInternal, {
          rows: products, source: "WinningHunter", sourceKey: "winninghunter",
        });
        r.productsCreated += res.created;
        r.productsUpdated += res.updated;
      }
      scroll = body?.scroll ?? undefined;
      if (!scroll || rows.length < 50) break;
      await new Promise((ok) => setTimeout(ok, 1100)); // stay under 60/min
    }
    return r;
  },
});

export const importNow = action({
  args: importArgs,
  handler: async (ctx, args): Promise<ImportResult> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    return await ctx.runAction(internal.winninghunter.importAdLibrary, args);
  },
});

export const creditsNow = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; credits?: unknown; error?: string }> => {
    const isAdmin = await ctx.runQuery(api.users.isAdmin, {});
    if (!isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    if (!process.env.WINNINGHUNTER_API_KEY) return { configured: false };
    try {
      return { configured: true, credits: await whGet("/credits", {}) };
    } catch (e) {
      return { configured: true, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

// Daily: winning + scaling active ads per market. Skips when no key is set.
export const dailyImport = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.WINNINGHUNTER_API_KEY) return null;
    const countries = (process.env.WH_COUNTRIES ?? "DK,SE,NO,DE,GB,US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    const pages = Number(process.env.WH_PAGES ?? 2) || 2;
    for (const country of countries) {
      await ctx.runAction(internal.winninghunter.importAdLibrary, { countries: country, adscorefilter: "winning", pages });
    }
    return null;
  },
});
