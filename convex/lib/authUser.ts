import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { initNewUser } from "./userRole";

// Convex Auth createOrUpdateUser: which user a sign-in belongs to.
// - Existing account (same provider account) → that user, refreshed.
// - Google sign-in whose email Google has verified → the user that already
//   has that email (e.g. made with a password), so one person keeps one
//   account and their role, saved items and alerts.
// - Otherwise a new user (first account becomes admin, see userRole.ts).

type Args = {
  existingUserId: Id<"users"> | null;
  type: string;
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean };
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

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
    if (sameEmail && (await refresh(sameEmail._id))) return sameEmail._id;
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
