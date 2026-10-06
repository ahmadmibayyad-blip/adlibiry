import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { limitedPage, requireSignedIn } from "./lib/access";
import { WINNERS_PER_NICHE, WINNER_MIN_SCORE } from "./productPipeline";

// ── Winning Products (read side) ────────────────────────────────────────────
// The list itself is rebuilt once a day by convex/productPipeline.ts.

export const feed = query({
  args: {
    paginationOpts: paginationOptsValidator,
    niche: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("mixed"), v.literal("byNiche"))),
  },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const rows = args.niche
      ? ctx.db.query("winningProducts").withIndex("by_niche_rank", (q) => q.eq("niche", args.niche!))
      : args.mode === "byNiche"
        ? ctx.db.query("winningProducts").withIndex("by_niche_rank")
        : ctx.db.query("winningProducts").withIndex("by_position");
    const today = new Date().toISOString().slice(0, 10);
    return await limitedPage(ctx, args.paginationOpts, async (paginationOpts) => {
      const result = await rows.paginate(paginationOpts);
      const page = (
        await Promise.all(
          result.page.map(async (r) => {
            const product = await ctx.db.get("products", r.productId);
            return product ? { niche: r.niche, nicheRank: r.nicheRank, isNewToday: r.enteredDay === today, product } : null;
          }),
        )
      ).filter((x) => x !== null);
      return { ...result, page };
    });
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("winningProducts").collect();
    const today = new Date().toISOString().slice(0, 10);
    const perNiche = new Map<string, number>();
    for (const r of rows) perNiche.set(r.niche, (perNiche.get(r.niche) ?? 0) + 1);
    const status = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
    return {
      total: rows.length,
      newToday: rows.filter((r) => r.enteredDay === today).length,
      perNiche: [...perNiche.entries()].map(([niche, filled]) => ({ niche, filled })).sort((a, b) => b.filled - a.filled),
      slots: WINNERS_PER_NICHE,
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
