import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { inspectHtml, type Inspection } from "./lib/storeInspect";
import { STORE_UA } from "./lib/pageFetch";
import { hostOf, storeTechFrom, type StoreTech } from "./lib/storeTech";

// Daily (crons.ts → importRuns "storeTech"): reads the home page of stores
// we list and keeps their theme, apps and pixels (lib/storeTech.ts) for the
// Stores page's filters. Never-read stores first, then the oldest; each
// store is read again after REFRESH_DAYS. A plain fetch only (no browser):
// a store that blocks it is marked unreadable and tried again next time round.

const PER_RUN = 60;
const REFRESH_DAYS = 30;
const SCAN = 3000;

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stale = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString();
    const fresh: { id: Id<"stores">; url: string }[] = [];
    const old: { id: Id<"stores">; url: string; at: string }[] = [];
    for (const s of await ctx.db.query("stores").withIndex("by_spotted").order("desc").take(SCAN)) {
      if (!s.url) continue;
      if (!s.tech) fresh.push({ id: s._id, url: s.url });
      else if (s.tech.checkedAt < stale) old.push({ id: s._id, url: s.url, at: s.tech.checkedAt });
    }
    old.sort((a, b) => a.at.localeCompare(b.at));
    return [...fresh, ...old].slice(0, PER_RUN).map(({ id, url }) => ({ id, url }));
  },
});

const techValidator = v.object({ checkedAt: v.string(), ok: v.boolean(), theme: v.optional(v.string()), apps: v.array(v.string()), pixels: v.array(v.string()) });

export const save = internalMutation({
  args: { id: v.id("stores"), tech: techValidator },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("stores", args.id);
    if (!store) return;
    // A failed read doesn't wipe what an earlier read found.
    const tech: StoreTech = !args.tech.ok && store.tech?.ok ? { ...store.tech, checkedAt: args.tech.checkedAt } : args.tech;
    await ctx.db.patch("stores", args.id, { tech });
  },
});

// Store Inspector results go onto the listed store with the same address
// (storeInspector.save calls it).
export async function techFromInspection(ctx: MutationCtx, host: string, result: Inspection, at: string): Promise<void> {
  const tech = storeTechFrom(result, at);
  if (!tech.ok) return;
  const rows = await ctx.db.query("stores").withIndex("by_host", (q) => q.eq("host", host)).take(5);
  for (const s of rows) await ctx.db.patch("stores", s._id, { tech });
}

async function homePage(url: string): Promise<string | null> {
  const host = hostOf(url);
  if (!host) return null;
  try {
    const res = await fetch(`https://${host}/`, {
      headers: { "User-Agent": STORE_UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? (await res.text()).slice(0, 3_000_000) : null;
  } catch {
    return null;
  }
}

export const daily = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fetched: number; updated: number; errors: string[] }> => {
    const todo = await ctx.runQuery(internal.storeTech.candidates, {});
    const out = { fetched: 0, updated: 0, errors: [] as string[] };
    const at = new Date().toISOString();
    // A few at a time: polite to the stores and quick enough for 60.
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(
        todo.slice(i, i + 6).map(async (s) => {
          const html = await homePage(s.url);
          if (html) out.fetched++;
          const tech = storeTechFrom(html ? inspectHtml(html) : null, at);
          if (tech.ok) out.updated++;
          try {
            await ctx.runMutation(internal.storeTech.save, { id: s.id, tech });
          } catch (e) {
            if (out.errors.length < 5) out.errors.push(`${hostOf(s.url) ?? s.url}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      );
    }
    return out;
  },
});
