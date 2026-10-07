import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { CURRENCIES, FALLBACK_RATES, allUsdRatesFromEcbXml, isCurrency, ratesFromEcbXml, type CurrencyCode } from "./lib/currency";

// Display currency per user (users.displayCurrency) and the daily exchange
// rates (siteStats["fxRates"], USD-based) from the European Central Bank.

type Rates = { rates: Record<CurrencyCode, number>; all?: Record<string, number>; date: string };

// Every ECB rate (USD-based), for converting store prices (convex/storeSales.ts).
export const allRates = internalQuery({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fxRates")).unique();
    const data = doc?.data as Rates | undefined;
    return data?.all ?? { ...FALLBACK_RATES };
  },
});

export const mine = query({
  args: {},
  handler: async (ctx): Promise<{ code: CurrencyCode; rate: number; rates: Record<CurrencyCode, number> }> => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fxRates")).unique();
    const rates = (doc?.data as Rates | undefined)?.rates ?? FALLBACK_RATES;
    const identity = await ctx.auth.getUserIdentity();
    const user = identity
      ? await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique()
      : null;
    const code = isCurrency(user?.displayCurrency) ? user.displayCurrency : "USD";
    return { code, rate: rates[code], rates };
  },
});

export const setMine = mutation({
  args: { code: v.union(...CURRENCIES.map((c) => v.literal(c))) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in.");
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (!user) throw new Error("Please sign in.");
    await ctx.db.patch("users", user._id, { displayCurrency: args.code });
  },
});

export const saveRates = internalMutation({
  args: { rates: v.object({ USD: v.number(), EUR: v.number(), GBP: v.number(), DKK: v.number() }), all: v.optional(v.record(v.string(), v.number())), date: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fxRates")).unique();
    const updatedAt = new Date().toISOString();
    if (doc) await ctx.db.patch("siteStats", doc._id, { data: args, updatedAt });
    else await ctx.db.insert("siteStats", { key: "fxRates", data: args, updatedAt });
  },
});

// Daily (crons.ts). Keeps the last good rates if the ECB can't be reached.
export const refreshRates = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    try {
      const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { signal: AbortSignal.timeout(15_000) });
      const xml = await res.text();
      const rates = res.ok ? ratesFromEcbXml(xml) : null;
      if (!rates) return { ok: false };
      const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] ?? new Date().toISOString().slice(0, 10);
      await ctx.runMutation(internal.currency.saveRates, { rates, all: allUsdRatesFromEcbXml(xml), date });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
});
