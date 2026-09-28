import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// "Winner of the day" is a daily pick. Auto-sync jobs set it on today's top
// products, so they must also clear it on the ones they picked on earlier
// days — otherwise every past pick stays a "winner" forever and the
// dashboard's "Winners Today" count only ever grows.
export async function retireStaleWinners(
  ctx: MutationCtx,
  source: string,
  category: string,
  keepIds: Id<"products">[],
): Promise<number> {
  const keep = new Set<string>(keepIds);
  const winners = await ctx.db
    .query("products")
    .withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true))
    .take(1000);
  let retired = 0;
  for (const p of winners) {
    if (p.source === source && p.category === category && !keep.has(p._id)) {
      await ctx.db.patch("products", p._id, { isWinnerOfDay: false });
      retired++;
    }
  }
  return retired;
}
