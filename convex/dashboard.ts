import { query } from "./_generated/server";
import type { DashboardStats } from "./lib/research";

// ── Home dashboard charts ───────────────────────────────────────────────────
// Saved once a day by the Research rebuild (convex/research.ts); null until
// the first run after this was added.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "dashboard")).unique();
    return doc ? { ...(doc.data as DashboardStats), updatedAt: doc.updatedAt } : null;
  },
});
