import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";

// ── Saved searches ──────────────────────────────────────────────────────────
// "Save current search" on Ad Spy, Products and Winners (src/components/filters.tsx
// SavedSearches): a named filter set per page, kept on the account so it shows on
// every device. `page` is the page's own key; `filters` is that page's filter
// object as it saved it, read back by the same page.

export const MAX_PER_PAGE = 20;
const MAX_FILTER_CHARS = 8000;

const PAGES = new Set(["adspy.savedSearches", "products.savedSearches", "winners.savedSearches"]);

async function currentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

async function requireUser(ctx: MutationCtx) {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to save searches." });
  return user;
}

function checkPage(page: string) {
  if (!PAGES.has(page)) throw new ConvexError({ code: "BAD_REQUEST", message: "Unknown page." });
}

function cleanEntry(name: string, filters: unknown, search: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) throw new ConvexError({ code: "BAD_REQUEST", message: "Give the search a name." });
  if (JSON.stringify(filters ?? null).length > MAX_FILTER_CHARS) throw new ConvexError({ code: "BAD_REQUEST", message: "That search has too many filters to save." });
  return { name: n, filters, search: search.slice(0, 200) };
}

async function rowsFor(ctx: QueryCtx, user: Doc<"users">, page: string) {
  return await ctx.db
    .query("savedSearches")
    .withIndex("by_user_page", (q) => q.eq("userId", user._id).eq("page", page))
    .order("desc")
    .take(MAX_PER_PAGE + 5);
}

/** This page's saved searches, newest first; null when signed out. */
export const list = query({
  args: { page: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    return (await rowsFor(ctx, user, args.page)).map((r) => ({ name: r.name, filters: r.filters, search: r.search }));
  },
});

// Saving under a name that exists replaces it; past MAX_PER_PAGE the oldest go.
async function put(ctx: MutationCtx, user: Doc<"users">, page: string, e: { name: string; filters: unknown; search: string }, at: string) {
  const rows = await rowsFor(ctx, user, page);
  for (const r of rows) if (r.name === e.name) await ctx.db.delete("savedSearches", r._id);
  await ctx.db.insert("savedSearches", { userId: user._id, page, ...e, savedAt: at });
  const kept = (await rowsFor(ctx, user, page)).slice(MAX_PER_PAGE);
  for (const r of kept) await ctx.db.delete("savedSearches", r._id);
}

export const save = mutation({
  args: { page: v.string(), name: v.string(), filters: v.any(), search: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    checkPage(args.page);
    await put(ctx, user, args.page, cleanEntry(args.name, args.filters, args.search), new Date().toISOString());
  },
});

export const remove = mutation({
  args: { page: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    for (const r of await rowsFor(ctx, user, args.page)) if (r.name === args.name) await ctx.db.delete("savedSearches", r._id);
  },
});

/**
 * One-time copy of a browser's older saved searches (they used to live in
 * localStorage). Names already on the account win; the list keeps its order.
 */
export const importLocal = mutation({
  args: { page: v.string(), items: v.array(v.object({ name: v.string(), filters: v.any(), search: v.string() })) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    checkPage(args.page);
    const have = new Set((await rowsFor(ctx, user, args.page)).map((r) => r.name));
    const base = Date.now() - args.items.length * 1000;
    let added = 0;
    // Oldest first, so the browser's newest stays on top.
    for (const [i, item] of [...args.items].slice(0, MAX_PER_PAGE).reverse().entries()) {
      let entry;
      try {
        entry = cleanEntry(item.name, item.filters, item.search ?? "");
      } catch {
        continue;
      }
      if (have.has(entry.name)) continue;
      await put(ctx, user, args.page, entry, new Date(base + i * 1000).toISOString());
      have.add(entry.name);
      added++;
    }
    return { added };
  },
});
