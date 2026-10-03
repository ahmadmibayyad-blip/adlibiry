import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";

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
