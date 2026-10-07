import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./admin/helpers";
import { stableToken } from "./lib/authIdentity";
import { EVENT_TYPES, northStar, type EventType, type NorthStar } from "./lib/northStar";

// Product-funnel events for the north-star metric (lib/northStar.ts). One row
// per user, event type and product per day; nothing else is recorded.

const today = () => new Date().toISOString().slice(0, 10);

export async function recordEvent(ctx: MutationCtx, userId: Id<"users">, type: EventType, productId?: Id<"products">) {
  const day = today();
  const same = await ctx.db
    .query("events")
    .withIndex("by_user_day_type", (q) => q.eq("userId", userId).eq("day", day).eq("type", type))
    .take(500);
  if (same.some((e) => e.productId === productId)) return;
  await ctx.db.insert("events", { userId, type, ...(productId ? { productId } : {}), day, at: Date.now() });
}

// From the app: product opened, verdict panel viewed, supplier link opened.
export const track = mutation({
  args: { type: v.union(v.literal("product_open"), v.literal("verdict_view"), v.literal("supplier_click")), productId: v.optional(v.id("products")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
    if (user) await recordEvent(ctx, user._id, args.type, args.productId);
  },
});

// Admin: the last 7 days.
export const weekly = query({
  args: {},
  handler: async (ctx): Promise<NorthStar & { since: string }> => {
    await requireAdmin(ctx);
    const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const rows = [];
    for (const type of EVENT_TYPES) {
      rows.push(...(await ctx.db.query("events").withIndex("by_type_day", (q) => q.eq("type", type).gte("day", since)).take(20_000)));
    }
    return { ...northStar(rows), since };
  },
});
