import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// "Winner of the day" is a daily pick. Auto-sync jobs set it on today's top
// products, so they must also clear it on the ones they picked on earlier
// days — otherwise every past pick stays a "winner" forever and the
// dashboard's "Winners Today" count only ever grows.
//
// A pick is identified by its slot ("<source>:<search niche>"), not by the
// product's category: the category is classified from the product itself and
// can differ from the niche that was searched. Older rows without a slot are
// matched by source + category, as before.
export async function retireStaleWinners(
  ctx: MutationCtx,
  slot: { source: string; niche: string },
  keepIds: Id<"products">[],
): Promise<number> {
  const keep = new Set<string>(keepIds);
  const key = winnerSlot(slot.source, slot.niche);
  const winners = await ctx.db
    .query("products")
    .withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true))
    .take(1000);
  let retired = 0;
  for (const p of winners) {
    const sameSlot = p.winnerSlot ? p.winnerSlot === key : p.source === slot.source && p.category === slot.niche;
    if (sameSlot && !keep.has(p._id)) {
      await ctx.db.patch("products", p._id, { isWinnerOfDay: false });
      retired++;
    }
  }
  return retired;
}

export const winnerSlot = (source: string, niche: string) => `${source}:${niche}`;
