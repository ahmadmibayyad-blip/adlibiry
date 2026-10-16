import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { PublicHoliday } from "./lib/sellingCalendar";

// Selling calendar: the country's public holidays from Nager.Date (date.nager.at, free, no key), kept per country
// and year so each is asked for once a month at most. The gift and deal days come from lib/sellingCalendar.ts,
// and the app puts both together (it knows today's date; a query doesn't re-run when the day changes).

const REFRESH_MS = 30 * 86_400_000;
const country = (c: string) => (/^[A-Z]{2}$/.test(c) ? c : null);

/** This year's and next year's public holidays in the country, and whether some still need loading. */
export const holidays = query({
  args: { country: v.string(), year: v.number() },
  handler: async (ctx, args) => {
    const code = country(args.country);
    if (!code) return { days: [] as PublicHoliday[], missing: false };
    const rows = await Promise.all(
      [args.year, args.year + 1].map((year) => ctx.db.query("publicHolidays").withIndex("by_country_year", (q) => q.eq("country", code).eq("year", year)).unique()),
    );
    return { days: rows.flatMap((r) => (r?.days ?? []) as PublicHoliday[]), missing: rows.some((r) => !r) };
  },
});

export const save = internalMutation({
  args: { country: v.string(), year: v.number(), days: v.array(v.object({ date: v.string(), name: v.string(), localName: v.string() })) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("publicHolidays").withIndex("by_country_year", (q) => q.eq("country", args.country).eq("year", args.year)).unique();
    if (row) await ctx.db.patch("publicHolidays", row._id, { days: args.days, fetchedAt: Date.now() });
    else await ctx.db.insert("publicHolidays", { ...args, fetchedAt: Date.now() });
  },
});

/** Loads the holidays the calendar is missing (signed-in users; a country Nager doesn't cover is kept as none). */
export const load = action({
  args: { country: v.string(), year: v.number() },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const code = country(args.country);
    if (!code || args.year < 2020 || args.year > 2100) return;
    const have = await ctx.runQuery(internal.sellingCalendar.fetchedAt, { country: code, years: [args.year, args.year + 1] });
    for (const year of [args.year, args.year + 1]) {
      const at = have[String(year)];
      if (at && Date.now() - at < REFRESH_MS) continue;
      try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`, { signal: AbortSignal.timeout(15_000) });
        // 404 / 204: Nager doesn't cover the country.
        const body = res.ok && res.status !== 204 ? ((await res.json().catch(() => [])) as { date?: string; name?: string; localName?: string; global?: boolean }[]) : [];
        const days = (Array.isArray(body) ? body : [])
          .filter((h) => typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && typeof h.name === "string" && h.global !== false)
          .map((h) => ({ date: h.date!, name: h.name!.slice(0, 80), localName: String(h.localName ?? "").slice(0, 80) }));
        if (res.ok || res.status === 404) await ctx.runMutation(internal.sellingCalendar.save, { country: code, year, days });
      } catch (e) {
        console.warn("Selling calendar: holidays not loaded", code, year, e instanceof Error ? e.message : e);
      }
    }
  },
});

export const fetchedAt = internalQuery({
  args: { country: v.string(), years: v.array(v.number()) },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const year of args.years) {
      const row = await ctx.db.query("publicHolidays").withIndex("by_country_year", (q) => q.eq("country", args.country).eq("year", year)).unique();
      if (row) out[String(year)] = row.fetchedAt;
    }
    return out;
  },
});
