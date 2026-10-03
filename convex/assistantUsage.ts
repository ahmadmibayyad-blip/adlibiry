import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan } from "./lib/billing";

const envNumber = (value: string | undefined, fallback: number) => Math.max(1, Number(value ?? fallback) || fallback);

type Claim = { allowed: boolean; used: number; signedIn: boolean; limit: number; message?: string };

// Daily cap on AI requests (assistant, AI tools, reports, image search,
// agents), so no account can run up the AI bill. `limit` is the paid/trial
// allowance (ASSISTANT_DAILY_LIMIT). Free accounts get AI_FREE_DAILY_LIMIT
// (default 5) each, and all free accounts together share
// AI_FREE_GLOBAL_DAILY_LIMIT (default 300) a day, so mass sign-ups can't run
// up the bill; paying customers never hit that shared ceiling. Checked and
// counted in one mutation, so parallel requests can't slip past. Admins are
// not capped. On a refusal, `message` says why.
export const claimMessage = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Claim> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { allowed: false, used: 0, signedIn: false, limit: args.limit };
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return { allowed: false, used: 0, signedIn: false, limit: args.limit };
    const free = effectivePlan(user) === "none";
    const limit = free ? Math.min(args.limit, envNumber(process.env.AI_FREE_DAILY_LIMIT, 5)) : args.limit;
    const day = new Date().toISOString().slice(0, 10);
    const row = await ctx.db
      .query("assistantUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    const used = row?.count ?? 0;
    if (user.role !== "admin" && used >= limit) {
      return {
        allowed: false,
        used,
        signedIn: true,
        limit,
        message: free
          ? `Free accounts get ${limit} AI requests a day, and you've used them. Start your free trial for ${args.limit} a day.`
          : `You've used all ${limit} AI requests for today. Come back tomorrow.`,
      };
    }
    if (free) {
      const total = await ctx.db.query("aiFreeUsage").withIndex("by_day", (q) => q.eq("day", day)).unique();
      if ((total?.count ?? 0) >= envNumber(process.env.AI_FREE_GLOBAL_DAILY_LIMIT, 300)) {
        return {
          allowed: false,
          used,
          signedIn: true,
          limit,
          message: "Free AI requests are used up for today. Start your free trial to keep using AI today.",
        };
      }
      if (total) await ctx.db.patch("aiFreeUsage", total._id, { count: total.count + 1 });
      else await ctx.db.insert("aiFreeUsage", { day, count: 1 });
    }
    if (row) await ctx.db.patch("assistantUsage", row._id, { count: used + 1 });
    else await ctx.db.insert("assistantUsage", { userId: user._id, day, count: 1 });
    return { allowed: true, used: used + 1, signedIn: true, limit };
  },
});
