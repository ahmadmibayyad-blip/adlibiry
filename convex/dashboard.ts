import { query } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import type { DashboardStats } from "./lib/research";

// ── Home dashboard charts ───────────────────────────────────────────────────
// Saved once a day by the Research rebuild (convex/research.ts); null until
// the first run after this was added.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "dashboard")).unique();
    return doc ? { ...(doc.data as DashboardStats), updatedAt: doc.updatedAt } : null;
  },
});

// "Just added" on the home page: the newest products and ads in AdSpy Pro
// (by when they were added, whatever their own dates), so an import shows
// up on the start page right away.
export const justAdded = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const [products, ads] = await Promise.all([
      ctx.db.query("products").order("desc").take(6),
      ctx.db.query("ads").order("desc").take(6),
    ]);
    return { products, ads };
  },
});
