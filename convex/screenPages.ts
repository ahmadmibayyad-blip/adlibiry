import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import { MAX_PAGE_PRODUCTS, SCREEN_PAGE_RUNS, pageTitle, type PageProduct } from "./lib/screenPage";
import { LINK_SHOTS } from "./lib/screenshots";

// Screenshot to page (/dashboard/page-builder): the pages a user made from screenshots, and how many
// they may make or change a day. The AI work is in screenPagesAi.ts.

const DAY_MS = 86_400_000;

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

async function usage(ctx: { db: QueryCtx["db"] }, user: Doc<"users">) {
  const limit = byTier(user, SCREEN_PAGE_RUNS);
  const runs = await ctx.db
    .query("screenPageRuns")
    .withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS))
    .take(limit);
  return { used: runs.length, limit };
}

const limitMessage = (limit: number) =>
  limit <= SCREEN_PAGE_RUNS.trial ? `You've made ${limit} pages today. Upgrade to Pro for ${SCREEN_PAGE_RUNS.paid} a day.` : `You've made or changed ${limit} pages today. Try again tomorrow.`;

/** The user's pages (newest first, without their HTML) and today's allowance. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const rows = await ctx.db.query("screenPages").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(30);
    return {
      ...(await usage(ctx, user)),
      pages: rows.map((p) => ({ _id: p._id, title: p.title, status: p.status, updatedAt: p.updatedAt })),
    };
  },
});

export const get = query({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) return null;
    const imageUrls = (await Promise.all(p.imageIds.map((id) => ctx.storage.getUrl(id)))).filter((u): u is string => !!u);
    const products = (await Promise.all((p.productIds ?? []).map((id) => ctx.db.get("importedProducts", id))))
      .filter((r) => !!r)
      .map((r) => ({ title: r.title, imageUrl: r.imageUrl, url: r.url }));
    return { ...p, imageUrls, products, canUndo: !!p.previousHtml };
  },
});

export const remove = mutation({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
    for (const id of p.imageIds) await ctx.storage.delete(id).catch(() => {});
    await ctx.db.delete("screenPages", p._id);
  },
});

/** Back to the HTML before the last change (once). */
export const undo = mutation({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || !user || p.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
    if (!p.previousHtml || p.status === "making") return;
    await ctx.db.patch("screenPages", p._id, { html: p.previousHtml, previousHtml: undefined, lastChange: undefined, updatedAt: Date.now() });
  },
});

/** Who is asking and whether today's allowance has room. */
export const before = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const u = await usage(ctx, user);
    return { userId: user._id, ...u, message: u.used >= u.limit ? limitMessage(u.limit) : null };
  },
});

/** Counts a screenshot taken from a link (pageShots.ts); the reason when today's are used up. */
export const claimShot = internalMutation({
  args: { token: v.string(), host: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return { ok: false, message: "Please sign in first." };
    const limit = byTier(user, LINK_SHOTS);
    const today = await ctx.db
      .query("pageShots")
      .withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS))
      .take(limit);
    if (today.length >= limit) {
      return { ok: false, message: limit <= LINK_SHOTS.trial ? `You've taken ${limit} screenshots from links today. Upgrade to Pro for ${LINK_SHOTS.paid} a day, or upload a screenshot.` : `You've taken ${limit} screenshots from links today. Upload one instead, or try again tomorrow.` };
    }
    await ctx.db.insert("pageShots", { userId: user._id, at: Date.now(), host: args.host });
    return { ok: true };
  },
});

export const insert = internalMutation({
  args: { userId: v.id("users"), imageIds: v.array(v.id("_storage")), notes: v.optional(v.string()), productIds: v.optional(v.array(v.id("importedProducts"))) },
  handler: async (ctx, args): Promise<Id<"screenPages">> => {
    const now = Date.now();
    // Only the user's own products, each once.
    const productIds: Id<"importedProducts">[] = [];
    for (const id of [...new Set(args.productIds ?? [])].slice(0, MAX_PAGE_PRODUCTS)) {
      const p = await ctx.db.get("importedProducts", id);
      if (p?.userId === args.userId) productIds.push(id);
    }
    await ctx.db.insert("screenPageRuns", { userId: args.userId, at: now });
    return ctx.db.insert("screenPages", {
      userId: args.userId,
      imageIds: args.imageIds,
      ...(args.notes ? { notes: args.notes } : {}),
      ...(productIds.length ? { productIds } : {}),
      title: "New page",
      status: "making",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Marks a ready page as being changed; null when it can't be (not theirs, or busy). */
export const startEdit = internalMutation({
  args: { id: v.id("screenPages"), userId: v.id("users"), change: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p || p.userId !== args.userId) return "Page not found.";
    if (p.status === "making") return "This page is still being made. Wait a moment.";
    if (!p.html) return "This page has no HTML to change. Make it again from the screenshot.";
    await ctx.db.insert("screenPageRuns", { userId: args.userId, at: Date.now() });
    await ctx.db.patch("screenPages", p._id, { status: "making", pending: args.change, error: undefined });
    return null;
  },
});

export const context = internalQuery({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return null;
    const user = await ctx.db.get("users", p.userId);
    const products: PageProduct[] = [];
    for (const id of p.productIds ?? []) {
      const r = await ctx.db.get("importedProducts", id);
      if (r) products.push({ title: r.title, url: r.url, images: [r.imageUrl, ...r.images].filter(Boolean), ...(r.shownPrice ? { price: r.shownPrice } : {}) });
    }
    return { page: p, products, isAdmin: user?.role === "admin" };
  },
});

export const finish = internalMutation({
  args: { id: v.id("screenPages"), html: v.string(), photoCredits: v.optional(v.array(v.object({ photographer: v.string(), photographerUrl: v.string(), pexelsUrl: v.string() }))) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return;
    await ctx.db.patch("screenPages", p._id, {
      html: args.html,
      previousHtml: p.html,
      lastChange: p.pending,
      // Photos kept from earlier versions keep their credit.
      ...(args.photoCredits ? { photoCredits: [...(p.photoCredits ?? []), ...args.photoCredits].filter((c, i, all) => all.findIndex((x) => x.photographerUrl === c.photographerUrl) === i) } : {}),
      pending: undefined,
      title: p.html ? p.title : pageTitle(args.html),
      status: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const fail = internalMutation({
  args: { id: v.id("screenPages"), error: v.string() },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return;
    // A failed change keeps the page as it was.
    await ctx.db.patch("screenPages", p._id, { status: p.html ? "ready" : "failed", error: args.error.slice(0, 400), pending: undefined, updatedAt: Date.now() });
  },
});

// ── Publish to Shopify (screenPagesShopify.ts) ──

const shopifyField = v.object({ shopDomain: v.string(), pageId: v.string(), url: v.string(), adminUrl: v.string(), publishedAt: v.number(), home: v.optional(v.boolean()) });

export const publishContext = internalQuery({
  args: { token: v.string(), id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const page = await ctx.db.get("screenPages", args.id);
    if (!page || page.userId !== user._id) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return { page, store, userId: user._id, isAdmin: user.role === "admin" };
  },
});

/** After publishing: where it is; and the page with its links set, when they were (undo goes back to before). */
export const published = internalMutation({
  args: { id: v.id("screenPages"), shopify: shopifyField, linkedHtml: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("screenPages", args.id);
    if (!p) return;
    await ctx.db.patch("screenPages", p._id, {
      shopify: args.shopify,
      ...(args.linkedHtml && args.linkedHtml !== p.html ? { html: args.linkedHtml, previousHtml: p.html, lastChange: "Linked the menu and buttons to your store" } : {}),
      // Published as it is now: not "changed since".
      updatedAt: Math.min(Date.now(), args.shopify.publishedAt),
    });
  },
});

export const homeBackup = internalQuery({
  args: { shopDomain: v.string(), themeId: v.string() },
  handler: async (ctx, args) =>
    ctx.db.query("homeBackups").withIndex("by_shop_theme", (q) => q.eq("shopDomain", args.shopDomain).eq("themeId", args.themeId)).first(),
});

/** Keeps the theme's own home page template (only ever the theme's, never a landing page's). */
export const saveHomeBackup = internalMutation({
  args: { userId: v.id("users"), shopDomain: v.string(), themeId: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("homeBackups").withIndex("by_shop_theme", (q) => q.eq("shopDomain", args.shopDomain).eq("themeId", args.themeId)).first();
    if (old) await ctx.db.patch("homeBackups", old._id, { content: args.content, savedAt: Date.now() });
    else await ctx.db.insert("homeBackups", { ...args, savedAt: Date.now() });
  },
});

/** The store's home page is the theme's own again: no page of the user's is shown as home there. */
export const homeRestored = internalMutation({
  args: { userId: v.id("users"), shopDomain: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("screenPages").withIndex("by_user", (q) => q.eq("userId", args.userId)).take(100);
    for (const p of rows) if (p.shopify?.home && p.shopify.shopDomain === args.shopDomain) await ctx.db.patch("screenPages", p._id, { shopify: { ...p.shopify, home: false } });
  },
});

/** Another page became the home page: the earlier one isn't anymore. */
export const homeMovedTo = internalMutation({
  args: { userId: v.id("users"), shopDomain: v.string(), id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("screenPages").withIndex("by_user", (q) => q.eq("userId", args.userId)).take(100);
    for (const p of rows) if (p._id !== args.id && p.shopify?.home && p.shopify.shopDomain === args.shopDomain) await ctx.db.patch("screenPages", p._id, { shopify: { ...p.shopify, home: false } });
  },
});
