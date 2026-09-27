import { internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// V8-runtime queries used by the Node-runtime email sender action (convex/emailSender.ts).
// Kept in a separate file because internalQuery cannot live in a "use node" file.

export const getDigestRecipients = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ email: string; userId: string }[]> => {
    const prefs = await ctx.db.query("alertPreferences").take(2000);
    const recipients: { email: string; userId: string }[] = [];
    for (const pref of prefs) {
      if (!pref.emailDigestEnabled) continue;
      const user = await ctx.db.get("users", pref.userId);
      if (user?.email) {
        recipients.push({ email: user.email, userId: user._id });
      }
    }
    return recipients;
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
