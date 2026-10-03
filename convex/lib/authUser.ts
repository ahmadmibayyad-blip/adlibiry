import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { initNewUser } from "./userRole";

// Convex Auth createOrUpdateUser: which user a sign-in belongs to.
// - Existing account (same provider account) → that user, refreshed.
// - Google sign-in whose email Google has verified → the user that already
//   has that email (e.g. made with a password), so one person keeps one
//   account and their role, saved items and alerts. Password sign-up never
//   proves the email, so if that account's email was never verified, its
//   password login and sessions are removed first: otherwise someone could
//   sign up with another person's email and share their account later.
// - Otherwise a new user (first account becomes admin, see userRole.ts).

type Args = {
  existingUserId: Id<"users"> | null;
  type: string;
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean };
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Before a verified Google sign-in takes over an account whose email was never
// verified: removes its password login and sessions, and everything else whoever
// made it could have attached (MCP keys, a Shopify store, a Stripe customer and
// subscription), so the real owner starts clean.
async function revokeUnprovenLogins(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const passwords = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
    .collect();
  for (const account of passwords) await ctx.db.delete("authAccounts", account._id);
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete("authRefreshTokens", token._id);
    await ctx.db.delete("authSessions", session._id);
  }
  const keys = await ctx.db.query("mcpKeys").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const key of keys) if (!key.revokedAt) await ctx.db.patch("mcpKeys", key._id, { revokedAt: new Date().toISOString() });
  const shops = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const shop of shops) await ctx.db.delete("shopifyConnections", shop._id);
  await ctx.db.patch("users", userId, {
    customerId: undefined,
    plan: undefined,
    subscriptionStatus: undefined,
    subscriptionId: undefined,
    planRenewsAt: undefined,
    subscriptionEventAt: undefined,
  });
}

export async function upsertAuthUser(ctx: MutationCtx, args: Args): Promise<Id<"users">> {
  const email = str(args.profile.email)?.toLowerCase();
  const name = str(args.profile.name);
  const image = str(args.profile.image);
  const verified = args.type === "oauth" && args.profile.emailVerified === true;

  const refresh = async (id: Id<"users">) => {
    const user = await ctx.db.get("users", id);
    if (!user) return false;
    await ctx.db.patch("users", id, {
      ...(email && !user.email ? { email } : {}),
      ...(name && !user.name ? { name } : {}),
      ...(image && !user.image ? { image } : {}),
      ...(verified && !user.emailVerificationTime ? { emailVerificationTime: Date.now() } : {}),
    });
    return true;
  };

  if (args.existingUserId && (await refresh(args.existingUserId))) return args.existingUserId;

  if (verified && email) {
    const sameEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (sameEmail) {
      if (!sameEmail.emailVerificationTime) await revokeUnprovenLogins(ctx, sameEmail._id);
      if (await refresh(sameEmail._id)) return sameEmail._id;
    }
  }

  const id = await ctx.db.insert("users", {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(image ? { image } : {}),
    ...(verified ? { emailVerificationTime: Date.now() } : {}),
  });
  await initNewUser(ctx, id);
  return id;
}
