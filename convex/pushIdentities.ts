import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getIdentityBySecret = internalQuery({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("pushIdentities")
      .withIndex("by_secret", (q) => q.eq("secret", args.secret))
      .first();
  },
});

export const storeIdentity = internalMutation({
  args: { secret: v.string(), visitorId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("pushIdentities", { secret: args.secret, visitorId: args.visitorId });
  },
});

export const updateIdentityVisitorId = internalMutation({
  args: { secret: v.string(), visitorId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.db
      .query("pushIdentities")
      .withIndex("by_secret", (q) => q.eq("secret", args.secret))
      .first();
    if (identity) {
      await ctx.db.patch("pushIdentities", identity._id, { visitorId: args.visitorId });
    }
  },
});

export const deleteIdentity = internalMutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.db
      .query("pushIdentities")
      .withIndex("by_secret", (q) => q.eq("secret", args.secret))
      .first();
    if (identity) {
      await ctx.db.delete("pushIdentities", identity._id);
    }
  },
});
