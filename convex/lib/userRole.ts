import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Runs once for every new account (Convex Auth afterUserCreatedOrUpdated).
// Sets the stable lookup key the app uses (see lib/authIdentity.ts) and the
// role: only the very first account becomes admin; every later sign-up is a
// normal user, and admins promote others from Admin → Users.
//
// (This used to also auto-promote any new sign-up whose email was listed in
// ADMIN_EMAILS. Sign-up never verifies email ownership, so anyone could
// register a listed address that hadn't signed up yet and get admin.)
export async function initNewUser(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const user = await ctx.db.get("users", userId);
  if (!user || user.tokenIdentifier) return;
  // Users table has no role index; this runs once per new account.
  const anyAdmin = await ctx.db
    .query("users")
    // eslint-disable-next-line @convex-dev/no-filter-in-query
    .filter((q) => q.eq(q.field("role"), "admin"))
    .first();
  await ctx.db.patch("users", userId, { tokenIdentifier: userId, role: anyAdmin ? "user" : "admin" });
}
