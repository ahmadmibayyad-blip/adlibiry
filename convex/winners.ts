import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { limitedPage, requireSignedIn } from "./lib/access";
import { WINNERS_PER_NICHE, WINNER_MIN_SCORE, readWinnersRound } from "./productPipeline";
import { WINNERS_ROUND_DAYS, WINNERS_TOP_KEEP } from "./lib/winnerMix";
import { filterAndSortWinners, needsFiltering } from "./lib/winnerFilters";

// ── Winning Products (read side) ────────────────────────────────────────────
// The list itself is rebuilt once a day by convex/productPipeline.ts.

export const feed = query({
  args: {
    paginationOpts: paginationOptsValidator,
    niche: v.optional(v.string()),
    // The user's niches (onboarding): any of these, when no single niche is picked.
    niches: v.optional(v.array(v.string())),
    mode: v.optional(v.union(v.literal("mixed"), v.literal("byNiche"))),
    // Ad Spy-style filters (see convex/lib/winnerFilters.ts).
    search: v.optional(v.string()),
    source: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    minMargin: v.optional(v.number()),
    minAiScore: v.optional(v.number()),
    minAds: v.optional(v.number()),
    minLikes: v.optional(v.number()),
    trend: v.optional(v.string()),
    saturation: v.optional(v.string()),
    hasStoreLink: v.optional(v.boolean()),
    newToday: v.optional(v.boolean()),
    sort: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const { paginationOpts, niche, niches, mode, ...filters } = args;
    const nicheSet = !niche && niches?.length ? new Set(niches) : null;
    const rows = niche
      ? ctx.db.query("winningProducts").withIndex("by_niche_rank", (q) => q.eq("niche", niche))
      : mode === "byNiche"
        ? ctx.db.query("winningProducts").withIndex("by_niche_rank")
        : ctx.db.query("winningProducts").withIndex("by_position");
    // "New" = entered the list in the current round (a new mix every 3 days).
    const roundDay = (await readWinnersRound(ctx))?.day ?? new Date().toISOString().slice(0, 10);
    const withProduct = async (r: Doc<"winningProducts">) => {
      const product = await ctx.db.get("products", r.productId);
      return product
        ? { niche: r.niche, nicheRank: r.nicheRank, position: r.position, isNewToday: r.enteredDay === roundDay, product }
        : null;
    };

    if (!needsFiltering(filters) && !nicheSet) {
      return await limitedPage(ctx, paginationOpts, async (opts) => {
        const result = await rows.paginate(opts);
        const page = (await Promise.all(result.page.map(withProduct))).filter((x) => x !== null);
        return { ...result, page };
      });
    }

    // Filtered: the whole list is at most WINNERS_PER_NICHE per niche, so
    // read it all, filter + sort, and page by offset.
    const all = (await Promise.all((await rows.collect()).filter((r) => !nicheSet || nicheSet.has(r.niche)).map(withProduct))).filter((x) => x !== null);
    const matched = filterAndSortWinners(all, filters);
    return await limitedPage(ctx, paginationOpts, async (opts) => {
      const start = Number(opts.cursor ?? 0) || 0;
      const end = start + opts.numItems;
      return { page: matched.slice(start, end), isDone: end >= matched.length, continueCursor: String(Math.min(end, matched.length)) };
    });
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("winningProducts").collect();
    const round = await readWinnersRound(ctx);
    const roundDay = round?.day ?? new Date().toISOString().slice(0, 10);
    const perNiche = new Map<string, number>();
    for (const r of rows) perNiche.set(r.niche, (perNiche.get(r.niche) ?? 0) + 1);
    const status = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
    return {
      total: rows.length,
      newToday: rows.filter((r) => r.enteredDay === roundDay).length,
      perNiche: [...perNiche.entries()].map(([niche, filled]) => ({ niche, filled })).sort((a, b) => b.filled - a.filled),
      slots: WINNERS_PER_NICHE,
      keepTop: WINNERS_TOP_KEEP,
      roundDays: WINNERS_ROUND_DAYS,
      roundDay: round?.day ?? null,
      nextRoundDay: round?.nextDay ?? null,
      minScore: WINNER_MIN_SCORE,
      updatedAt: (status?.data as { finishedAt?: string } | undefined)?.finishedAt ?? null,
    };
  },
});

// "#3 in Pet Supplies" for one product, or null if it isn't a winner.
export const forProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const row = await ctx.db
      .query("winningProducts")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .first();
    return row ? { niche: row.niche, nicheRank: row.nicheRank, enteredDay: row.enteredDay } : null;
  },
});

// Public: the homepage's "Today's winners" panel. Five rows, one per niche,
// with only the fields the panel shows. The full feed needs a signed-in user.
export const homepagePreview = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("winningProducts").withIndex("by_position").take(40);
    const seen = new Set<string>();
    const out: { _id: string; niche: string; nicheRank: number; title: string; imageUrl: string; aiScore: number }[] = [];
    for (const r of rows) {
      if (out.length === 5 || seen.has(r.niche)) continue;
      const p = await ctx.db.get("products", r.productId);
      if (!p?.imageUrl) continue;
      seen.add(r.niche);
      out.push({ _id: p._id, niche: r.niche, nicheRank: r.nicheRank, title: p.title, imageUrl: p.imageUrl, aiScore: p.aiScore });
    }
    return out;
  },
});
