import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";

// Daily message cap for the AI assistant, so one account can't run up the
// Claude bill. Checked and counted in one mutation, so parallel requests
// can't slip past the limit. Admins are not capped.
export const claimMessage = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<{ allowed: boolean; used: number; signedIn: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { allowed: false, used: 0, signedIn: false };
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return { allowed: false, used: 0, signedIn: false };
    const day = new Date().toISOString().slice(0, 10);
    const row = await ctx.db
      .query("assistantUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    const used = row?.count ?? 0;
    if (user.role !== "admin" && used >= args.limit) return { allowed: false, used, signedIn: true };
    if (row) await ctx.db.patch("assistantUsage", row._id, { count: used + 1 });
    else await ctx.db.insert("assistantUsage", { userId: user._id, day, count: 1 });
    return { allowed: true, used: used + 1, signedIn: true };
  },
});
