import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { resultLimit } from "./lib/billing";

// ── Personal access keys for the MCP server ─────────────────────────────────
// A customer creates a key in Settings and pastes it into their AI app
// (Claude, ChatGPT, Cursor…). Only a SHA-256 hash is stored, so a leaked
// database never leaks working keys. MCP_DAILY_LIMIT (default 300) caps tool
// calls per user per day; admins are not capped.

const MAX_ACTIVE_KEYS = 5;

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

export const listMyKeys = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const keys = await ctx.db
      .query("mcpKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return keys
      .filter((k) => !k.revokedAt)
      .map((k) => ({ _id: k._id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
});

// Runs as an action so the key comes from a real random source (mutations
// are deterministic).
export const createKey = action({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<{ key: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (resultLimit(user) !== null) {
      throw new ConvexError({ code: "PLAN_REQUIRED", message: "Connecting an AI app is part of the paid plans. It unlocks when your paid plan starts." });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = `asp_${secret}`;
    await ctx.runMutation(internal.mcpKeys.storeKey, {
      userId: user._id,
      name: args.name.trim().slice(0, 40) || "My AI app",
      keyHash: await hashKey(key),
      prefix: key.slice(0, 10),
    });
    return { key };
  },
});

export const storeKey = internalMutation({
  args: { userId: v.id("users"), name: v.string(), keyHash: v.string(), prefix: v.string() },
  handler: async (ctx, args) => {
    const active = (
      await ctx.db
        .query("mcpKeys")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect()
    ).filter((k) => !k.revokedAt);
    if (active.length >= MAX_ACTIVE_KEYS) {
      throw new ConvexError({ code: "LIMIT", message: `You can have at most ${MAX_ACTIVE_KEYS} keys. Delete one first.` });
    }
    await ctx.db.insert("mcpKeys", { ...args, createdAt: new Date().toISOString() });
  },
});

export const revokeKey = mutation({
  args: { id: v.id("mcpKeys") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const key = await ctx.db.get("mcpKeys", args.id);
    if (!user || !key || key.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Key not found" });
    await ctx.db.patch("mcpKeys", args.id, { revokedAt: new Date().toISOString() });
  },
});

// Looks up a key for the MCP endpoint. Returns null for unknown or revoked keys.
export const findKey = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args): Promise<{ keyId: Id<"mcpKeys">; userId: Id<"users">; paying: boolean } | null> => {
    const key = await ctx.db
      .query("mcpKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!key || key.revokedAt) return null;
    const user = await ctx.db.get("users", key.userId);
    // Checked on every request, so a key stops working when its owner stops paying.
    return user ? { keyId: key._id, userId: user._id, paying: resultLimit(user) === null } : null;
  },
});

// Counts one tool call against the user's daily cap and marks the key used.
// Checked and counted together so parallel calls can't slip past the cap.
export const claimToolCall = internalMutation({
  args: { keyId: v.id("mcpKeys"), limit: v.number() },
  handler: async (ctx, args): Promise<{ allowed: boolean; used: number }> => {
    const key = await ctx.db.get("mcpKeys", args.keyId);
    if (!key || key.revokedAt) return { allowed: false, used: 0 };
    const user = await ctx.db.get("users", key.userId);
    if (!user) return { allowed: false, used: 0 };
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const row = await ctx.db
      .query("mcpUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    const used = row?.count ?? 0;
    if (user.role !== "admin" && used >= args.limit) return { allowed: false, used };
    if (row) await ctx.db.patch("mcpUsage", row._id, { count: used + 1 });
    else await ctx.db.insert("mcpUsage", { userId: user._id, day, count: 1 });
    await ctx.db.patch("mcpKeys", key._id, { lastUsedAt: now });
    return { allowed: true, used: used + 1 };
  },
});
