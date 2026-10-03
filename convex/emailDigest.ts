import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// V8-runtime queries used by the Node-runtime email sender action (convex/emailSender.ts).
// Kept in a separate file because internalQuery cannot live in a "use node" file.

// One page of recipients; the sender keeps asking until isDone.
export const getDigestRecipients = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<{ recipients: { email: string; userId: string }[]; continueCursor: string; isDone: boolean }> => {
    const prefs = await ctx.db.query("alertPreferences").paginate({ numItems: 500, cursor: args.cursor });
    const recipients: { email: string; userId: string }[] = [];
    for (const pref of prefs.page) {
      if (!pref.emailDigestEnabled) continue;
      const user = await ctx.db.get("users", pref.userId);
      if (user?.email) {
        recipients.push({ email: user.email, userId: user._id });
      }
    }
    return { recipients, continueCursor: prefs.continueCursor, isDone: prefs.isDone };
  },
});

export const getTodaysWinners = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"products">[]> => {
    return await ctx.db
      .query("products")
      .withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true))
      .order("desc")
      .take(6);
  },
});
