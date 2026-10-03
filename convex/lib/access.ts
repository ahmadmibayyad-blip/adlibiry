import { ConvexError } from "convex/values";
import type { Auth, PaginationOptions, PaginationResult } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import { stableToken } from "./authIdentity";
import { resultLimit } from "./billing";

// Product, ad, store and trend data is for signed-in users only. Public queries
// that return it call this first; backend code that runs without a user (agents,
// assistant tools, MCP, crons) uses the matching internal query instead.
// What stays public on purpose: aggregate counts (stats:get, winners:summary)
// and the small homepage previews (winners:homepagePreview, ads:homepagePreview).
export async function requireSignedIn(ctx: { auth: Auth }): Promise<void> {
  if (!(await ctx.auth.getUserIdentity())) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to see this." });
  }
}

// How many results of each list the signed-in user may see (null: all).
// Free and trial accounts get the first 10; see resultLimit in lib/billing.ts.
export async function resultLimitFor(ctx: QueryCtx): Promise<number | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return resultLimit(null);
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
  return resultLimit(user);
}

// Runs a paginated list, capped for limited accounts: one page of at most
// `limit` results, and "load more" returns nothing.
export async function limitedPage<T>(
  ctx: QueryCtx,
  opts: PaginationOptions,
  run: (opts: PaginationOptions) => Promise<PaginationResult<T>>,
): Promise<PaginationResult<T>> {
  const limit = await resultLimitFor(ctx);
  if (limit === null) return await run(opts);
  if (opts.cursor) return { page: [], isDone: true, continueCursor: opts.cursor };
  const result = await run({ ...opts, numItems: Math.min(opts.numItems, limit) });
  return { ...result, page: result.page.slice(0, limit), isDone: true };
}
