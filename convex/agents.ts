import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { NICHES } from "./lib/category";

// ── AI agents ───────────────────────────────────────────────────────────────
// A customer writes a standing goal ("watch Pet Supplies for products scoring
// 80+ under $30"); every morning Claude works on it with the app's data tools
// and writes a short briefing (convex/agentRunner.ts). Customers can also run
// one by hand, which counts against the AI daily limit.

export const MAX_AGENTS = 3; // per customer; admins get 10
const MAX_GOAL = 1000;
const KEEP_BRIEFINGS = 30;

async function me(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

async function mine(ctx: QueryCtx, id: Id<"agents">) {
  const user = await me(ctx);
  const agent = await ctx.db.get("agents", id);
  if (!user || !agent || agent.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
  return { user, agent };
}

function clean(args: { name: string; goal: string; niches: string[] }) {
  const name = args.name.trim().slice(0, 60) || "My agent";
  const goal = args.goal.trim();
  if (goal.length < 10) throw new ConvexError({ code: "BAD_REQUEST", message: "Describe what the agent should look for (at least 10 characters)." });
  if (goal.length > MAX_GOAL) throw new ConvexError({ code: "BAD_REQUEST", message: `Keep the goal under ${MAX_GOAL} characters.` });
  const niches = [...new Set(args.niches)].filter((n) => (NICHES as readonly string[]).includes(n)).slice(0, 6);
  return { name, goal, niches };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await me(ctx);
    if (!user) return [];
    const agents = await ctx.db.query("agents").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return await Promise.all(
      agents.map(async (a) => ({
        ...a,
        latest: await ctx.db.query("agentBriefings").withIndex("by_agent", (q) => q.eq("agentId", a._id)).order("desc").first(),
      })),
    );
  },
});

export const briefings = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    await mine(ctx, args.agentId);
    return await ctx.db.query("agentBriefings").withIndex("by_agent", (q) => q.eq("agentId", args.agentId)).order("desc").take(10);
  },
});

export const create = mutation({
  args: { name: v.string(), goal: v.string(), niches: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const count = (await ctx.db.query("agents").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).length;
    const max = user.role === "admin" ? 10 : MAX_AGENTS;
    if (count >= max) throw new ConvexError({ code: "LIMIT", message: `You can have up to ${max} agents. Delete one to add another.` });
    return await ctx.db.insert("agents", { userId: user._id, ...clean(args), enabled: true, createdAt: new Date().toISOString() });
  },
});

export const update = mutation({
  args: { id: v.id("agents"), name: v.string(), goal: v.string(), niches: v.array(v.string()), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await mine(ctx, args.id);
    await ctx.db.patch("agents", args.id, { ...clean(args), enabled: args.enabled });
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    await mine(ctx, args.id);
    for (const b of await ctx.db.query("agentBriefings").withIndex("by_agent", (q) => q.eq("agentId", args.id)).collect()) {
      await ctx.db.delete("agentBriefings", b._id);
    }
    await ctx.db.delete("agents", args.id);
  },
});

// ── For the runner ──────────────────────────────────────────────────────────

// The agent, if the signed-in user owns it (manual runs).
export const ownedForRun = internalQuery({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    const user = await me(ctx);
    const agent = await ctx.db.get("agents", args.id);
    return user && agent && agent.userId === user._id ? agent : null;
  },
});

export const forRun = internalQuery({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.id);
    if (!agent) return null;
    const last = await ctx.db.query("agentBriefings").withIndex("by_agent", (q) => q.eq("agentId", args.id)).order("desc").first();
    return { agent, lastBriefing: last?.status === "ok" ? last.text : undefined };
  },
});

export const enabledIds = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("agents").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(args.limit);
    return rows.map((a) => a._id);
  },
});

export const saveBriefing = internalMutation({
  args: { agentId: v.id("agents"), status: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent) return;
    const now = new Date().toISOString();
    await ctx.db.insert("agentBriefings", { agentId: agent._id, userId: agent.userId, createdAt: now, status: args.status, text: args.text });
    await ctx.db.patch("agents", agent._id, { lastRunAt: now, lastStatus: args.status });
    // Keep the newest briefings only.
    const old = await ctx.db.query("agentBriefings").withIndex("by_agent", (q) => q.eq("agentId", agent._id)).order("desc").collect();
    for (const b of old.slice(KEEP_BRIEFINGS)) await ctx.db.delete("agentBriefings", b._id);
  },
});
