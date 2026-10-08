import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan, onProTrial } from "./lib/billing";
import { suggestPrice } from "./lib/launchCopy";

// ── Launch: winning product → product page in the user's Shopify store ──────
// start() checks the plan, the monthly quota and the product, then schedules
// launchRun.run (Claude writes the page and ad kit; we publish it with the
// Admin API). The page shows progress from the launches row.
// Quota: Pro 10 published pages a month (LAUNCH_MONTHLY_PRO), Pro trial 2 in
// total, agency plan and admins unlimited.

const PRO_MONTHLY = () => Math.max(0, Number(process.env.LAUNCH_MONTHLY_PRO ?? 10) || 10);
const TRIAL_TOTAL = 2;
const month = () => new Date().toISOString().slice(0, 7);

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

/** How many launches are left this month (null: unlimited); undefined when Launch isn't in the plan. */
async function allowance(ctx: QueryCtx, user: Doc<"users">): Promise<{ left: number | null; limit: number | null } | undefined> {
  const plan = effectivePlan(user);
  if (plan === "none") return undefined;
  if (plan === "agency") return { left: null, limit: null };
  if (onProTrial(user) && !user.subscriptionStatus) {
    const all = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", user._id)).collect();
    const used = all.reduce((s, r) => s + r.count, 0);
    return { left: Math.max(0, TRIAL_TOTAL - used), limit: TRIAL_TOTAL };
  }
  const row = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", user._id).eq("month", month())).unique();
  return { left: Math.max(0, PRO_MONTHLY() - (row?.count ?? 0)), limit: PRO_MONTHLY() };
}

/** The Launch dialog: store, quota, suggested price and the last launch of this product. */
export const prepare = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const product = await ctx.db.get("products", args.productId);
    if (!product) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const last = await ctx.db
      .query("launches")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id).eq("productId", args.productId))
      .order("desc")
      .first();
    return {
      allowed: (await allowance(ctx, user)) ?? null,
      store: store ? { shopDomain: store.shopDomain, shopName: store.shopName, locale: store.locale ?? "en", currency: store.currency ?? "USD" } : null,
      blocked: product.isBigBrand ? "This is a big-brand product. Selling it risks trademark claims and Meta and Shopify bans, so Launch is off for it." : null,
      suggested: suggestPrice({ price: product.price, cost: product.cost }),
      last: last ?? null,
    };
  },
});

export const start = mutation({
  args: {
    productId: v.id("products"),
    language: v.string(),
    tone: v.union(v.literal("friendly"), v.literal("premium"), v.literal("bold")),
    price: v.optional(v.number()),
    publish: v.union(v.literal("DRAFT"), v.literal("ACTIVE")),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const allowed = await allowance(ctx, user);
    if (!allowed) throw new ConvexError({ code: "PLAN_REQUIRED", message: "Launch is part of Pro. Start the 7-day trial or upgrade to use it." });
    if (allowed.left === 0) throw new ConvexError({ code: "LIMIT", message: `You've used your ${allowed.limit} launches${allowed.limit === TRIAL_TOTAL ? " on the trial" : " this month"}.` });
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found." });
    if (product.isBigBrand) throw new ConvexError({ code: "BLOCKED", message: "Launch is off for big-brand products (trademark risk)." });
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first (Settings → Shopify)." });
    const running = await ctx.db
      .query("launches")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id).eq("productId", args.productId))
      .order("desc")
      .first();
    if (running && (running.status === "generating" || running.status === "publishing")) return { launchId: running._id };
    const price = args.price && args.price > 0 ? Math.round(args.price * 100) / 100 : suggestPrice(product).price;
    const launchId = await ctx.db.insert("launches", {
      userId: user._id,
      productId: args.productId,
      shopDomain: store.shopDomain,
      status: "generating",
      language: args.language.slice(0, 40) || "English",
      tone: args.tone,
      publish: args.publish,
      ...(price ? { price } : {}),
      createdAt: new Date().toISOString(),
    });
    await ctx.scheduler.runAfter(0, internal.launchRun.run, { launchId });
    return { launchId };
  },
});

export const get = query({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const l = await ctx.db.get("launches", args.launchId);
    return l && user && l.userId === user._id ? l : null;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
    return Promise.all(rows.map(async (l) => ({ ...l, product: await ctx.db.get("products", l.productId).then((p) => (p ? { title: p.title, imageUrl: p.imageUrl } : null)) })));
  },
});

// ── internal steps (launchRun.ts) ────────────────────────────────────────────

export const context = internalQuery({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const launch = await ctx.db.get("launches", args.launchId);
    if (!launch) return null;
    const product = await ctx.db.get("products", launch.productId);
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", launch.userId)).unique();
    if (!product || !store) return { launch, product: null, store: null, ads: [] };
    // The ads already selling it, best first: their angles shape the page and ad kit.
    const ads = (await Promise.all((product.adIds ?? []).slice(0, 30).map((id) => ctx.db.get("ads", id))))
      .filter((a): a is Doc<"ads"> => !!a)
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 3)
      .map((a) => ({ headline: a.headline, bodyText: a.bodyText, platform: a.platform, ...(a.spokenHook ? { spokenHook: a.spokenHook } : {}) }));
    return { launch, product, store, ads };
  },
});

export const setStatus = internalMutation({
  args: {
    launchId: v.id("launches"),
    status: v.string(),
    copy: v.optional(v.any()),
    shopifyProductId: v.optional(v.string()),
    adminUrl: v.optional(v.string()),
    storeUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { launchId, ...patch }) => {
    const launch = await ctx.db.get("launches", launchId);
    if (!launch) return;
    const done = patch.status === "published" || patch.status === "failed";
    await ctx.db.patch("launches", launchId, { ...Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)), ...(done ? { finishedAt: new Date().toISOString() } : {}) });
    if (patch.status === "published") {
      // Counts toward the quota only once it's live in the store.
      const row = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", launch.userId).eq("month", month())).unique();
      if (row) await ctx.db.patch("launchUsage", row._id, { count: row.count + 1 });
      else await ctx.db.insert("launchUsage", { userId: launch.userId, month: month(), count: 1 });
    }
  },
});
