import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan, onProTrial } from "./lib/billing";
import { MAX_AI_PHOTOS, aiPhotosReady } from "./lib/aiPhotos";
import { suggestPrice } from "./lib/launchCopy";
import { missingStoreScopes } from "./lib/shopifyOAuth";
import { isStoreStyle } from "./lib/storeStyles";

// ── Launch: winning product → product page (or a full store) in the user's Shopify store ──
// start() checks the plan, the monthly quota and the product, then schedules
// launchRun.run (Claude writes the page and ad kit; we publish it with the
// Admin API). Mode "store" also writes the home page, About/FAQ/Shipping/Contact
// pages and menus, and installs our storefront theme (shopify-theme/) in the
// chosen style as an unpublished theme; publishTheme() makes it the live one.
// The page shows progress from the launches row.
// Quota: Pro 10 published pages a month (LAUNCH_MONTHLY_PRO), Pro trial 2 in
// total, agency plan and admins unlimited.

const PRO_MONTHLY = () => Math.max(0, Number(process.env.LAUNCH_MONTHLY_PRO ?? 10) || 10);
const TRIAL_TOTAL = 2;
const month = () => new Date().toISOString().slice(0, 7);

/** Units of `currency` per USD from the daily ECB rates (currency.ts); 1 for USD or an unknown currency. */
async function usdRate(ctx: QueryCtx, currency: string): Promise<number> {
  if (currency === "USD") return 1;
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "fxRates")).unique();
  const data = (doc?.data as { all?: Record<string, number>; rates?: Record<string, number> } | undefined) ?? {};
  const rate = data.all?.[currency] ?? data.rates?.[currency];
  return rate && rate > 0 ? rate : 1;
}

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
    const currency = store?.currency ?? "USD";
    return {
      allowed: (await allowance(ctx, user)) ?? null,
      store: store
        ? {
            shopDomain: store.shopDomain,
            shopName: store.shopName,
            locale: store.locale ?? "en",
            currency,
            viaApp: store.via === "oauth",
            // false: connected with a token before we saved the currency (shopifyImport.refreshStoreInfo reads it).
            currencyKnown: !!store.currency,
            infoComplete: !!store.currency && !!store.locale && store.shopName !== store.shopDomain,
            // Full store needs theme, page and menu access; app installs from before it need a reconnect.
            missingStoreScopes: store.via === "oauth" ? missingStoreScopes(store.scopes ?? "") : [],
          }
        : null,
      blocked: product.isBigBrand ? "This is a big-brand product. Selling it risks trademark claims and Meta and Shopify bans, so Launch is off for it." : null,
      // In the store's currency (product prices and costs are USD).
      suggested: suggestPrice({ price: product.price, cost: product.cost }, { currency, rate: await usdRate(ctx, currency) }),
      last: last ?? null,
      aiPhotosReady: aiPhotosReady(),
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
    mode: v.optional(v.union(v.literal("page"), v.literal("store"))),
    style: v.optional(v.string()),
    brandName: v.optional(v.string()),
    aiPhotos: v.optional(v.number()),
    facts: v.optional(
      v.object({ shippingTime: v.string(), returnDays: v.number(), freeShippingFrom: v.optional(v.number()), supportEmail: v.optional(v.string()) }),
    ),
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
    const currency = store.currency ?? "USD";
    const price =
      args.price && args.price > 0 ? Math.round(args.price * 100) / 100 : suggestPrice(product, { currency, rate: await usdRate(ctx, currency) }).price;
    let storeFields = {};
    if (args.mode === "store") {
      if (!isStoreStyle(args.style)) throw new ConvexError({ code: "BAD_STYLE", message: "Pick a style for your store." });
      if (store.via === "oauth" && missingStoreScopes(store.scopes ?? "").length) {
        throw new ConvexError({ code: "RECONNECT", message: "Building a full store needs new permissions. Reconnect your Shopify store (Settings → Shopify), then try again." });
      }
      const f = args.facts;
      const email = f?.supportEmail?.trim().slice(0, 120);
      storeFields = {
        mode: "store",
        style: args.style,
        brandName: (args.brandName?.trim() || store.shopName).slice(0, 60),
        facts: {
          shippingTime: (f?.shippingTime.trim() || "5–10 business days").slice(0, 60),
          returnDays: Math.min(365, Math.max(0, Math.round(f?.returnDays ?? 30))),
          ...(f?.freeShippingFrom && f.freeShippingFrom > 0 ? { freeShippingFrom: Math.round(f.freeShippingFrom * 100) / 100 } : {}),
          ...(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { supportEmail: email } : {}),
          currency,
        },
      };
    }
    const launchId = await ctx.db.insert("launches", {
      userId: user._id,
      productId: args.productId,
      shopDomain: store.shopDomain,
      status: "generating",
      language: args.language.slice(0, 40) || "English",
      tone: args.tone,
      publish: args.publish,
      ...(price ? { price } : {}),
      ...(args.aiPhotos && args.aiPhotos > 0 && aiPhotosReady() ? { aiPhotos: Math.min(MAX_AI_PHOTOS, Math.round(args.aiPhotos)) } : {}),
      ...storeFields,
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

/** The Launch dashboard header: plan, quota used/left, the connected store, totals. */
export const myQuota = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const allowed = await allowance(ctx, user);
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const rows = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const now = month();
    return {
      plan: effectivePlan(user),
      aiPhotosReady: aiPhotosReady(),
      // null when Launch isn't in the plan; left/limit null = unlimited.
      allowed: allowed ?? null,
      used: allowed && allowed.limit !== null && allowed.left !== null ? allowed.limit - allowed.left : null,
      store: store
        ? { shopDomain: store.shopDomain, shopName: store.shopName, viaApp: store.via === "oauth", locale: store.locale ?? "en", currency: store.currency ?? "USD" }
        : null,
      totals: {
        launches: rows.length,
        published: rows.filter((l) => l.status === "published").length,
        publishedThisMonth: rows.filter((l) => l.status === "published" && (l.finishedAt ?? l.createdAt).slice(0, 7) === now).length,
      },
    };
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
    if (!product || !store) return { launch, product: null, store: null, ads: [], rate: 1, previousShopifyProductId: undefined };
    // The ads already selling it, best first: their angles shape the page and ad kit.
    const ads = (await Promise.all((product.adIds ?? []).slice(0, 30).map((id) => ctx.db.get("ads", id))))
      .filter((a): a is Doc<"ads"> => !!a)
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 3)
      .map((a) => ({ headline: a.headline, bodyText: a.bodyText, platform: a.platform, ...(a.spokenHook ? { spokenHook: a.spokenHook } : {}) }));
    // The product an earlier launch of this product created in this store: launching again updates it.
    const earlier = await ctx.db
      .query("launches")
      .withIndex("by_user_product", (q) => q.eq("userId", launch.userId).eq("productId", launch.productId))
      .order("desc")
      .take(20);
    const previousShopifyProductId = earlier.find((l) => l._id !== launch._id && l.shopDomain === store.shopDomain && l.shopifyProductId)?.shopifyProductId;
    // rate: store currency per USD, for the supplier cost we send to Shopify.
    return { launch, product, store, ads, rate: await usdRate(ctx, store.currency ?? "USD"), previousShopifyProductId };
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
    store: v.optional(v.any()),
    productHandle: v.optional(v.string()),
    pageHandles: v.optional(v.record(v.string(), v.string())),
    step: v.optional(v.string()),
    themeId: v.optional(v.string()),
    themePreviewUrl: v.optional(v.string()),
    themeEditorUrl: v.optional(v.string()),
    aiPhotoUrls: v.optional(v.array(v.string())),
    aiPhotoIds: v.optional(v.array(v.id("_storage"))),
    aiPhotoNote: v.optional(v.string()),
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

// ── Ad images (launchAds.ts) ─────────────────────────────────────────────────

export const MAX_AD_IMAGE_RUNS = 3;

/** Claims an ad-image run for the launch's owner: the launch, its product's photos, and the ad kit. */
export const startAdImages = internalMutation({
  args: { launchId: v.id("launches"), token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    const l = await ctx.db.get("launches", args.launchId);
    if (!user || !l || l.userId !== user._id) return { error: "Launch not found." };
    const adKit = (l.copy as { adKit?: { angle: string; hook: string }[] } | undefined)?.adKit ?? [];
    if (l.status !== "published" || !adKit.length) return { error: "This launch has no ad kit yet." };
    if (l.adImagesStatus === "making") return { error: "The ad images are already being made." };
    if ((l.adImageRuns ?? 0) >= MAX_AD_IMAGE_RUNS) return { error: `You've made ad images ${MAX_AD_IMAGE_RUNS} times for this launch.` };
    const product = await ctx.db.get("products", l.productId);
    if (!product) return { error: "The product is gone." };
    await ctx.db.patch("launches", l._id, { adImagesStatus: "making", adImagesNote: undefined, adImageRuns: (l.adImageRuns ?? 0) + 1 });
    return { product: { title: product.title, category: product.category, imageUrl: product.imageUrl, images: product.images ?? [] }, aiPhotoUrls: l.aiPhotoUrls ?? [], adKit };
  },
});

export const saveAdImages = internalMutation({
  args: {
    launchId: v.id("launches"),
    images: v.array(v.object({ id: v.id("_storage"), url: v.string(), angle: v.string(), ad: v.number() })),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const l = await ctx.db.get("launches", args.launchId);
    if (!l) return;
    // A new set replaces the old one; keep the old set if nothing new came out.
    const replaced = args.images.length ? l.adImages ?? [] : [];
    for (const old of replaced) await ctx.storage.delete(old.id).catch(() => {});
    await ctx.db.patch("launches", args.launchId, {
      adImagesStatus: "done",
      adImagesNote: args.note,
      ...(args.images.length ? { adImages: args.images } : {}),
    });
  },
});

// ── Full store ───────────────────────────────────────────────────────────────

/** Makes the theme a Full store launch built the store's live theme. */
export const publishTheme = mutation({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const l = await ctx.db.get("launches", args.launchId);
    if (!user || !l || l.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Launch not found." });
    if (!l.themeId || l.status !== "published") throw new ConvexError({ code: "NOT_READY", message: "The store isn't ready yet." });
    if (l.themeLive) return;
    await ctx.db.patch("launches", args.launchId, { step: "going-live", error: undefined });
    await ctx.scheduler.runAfter(0, internal.launchRun.publishTheme, { launchId: args.launchId });
  },
});

export const markThemeLive = internalMutation({
  args: { launchId: v.id("launches"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch("launches", args.launchId, args.error ? { error: args.error, step: undefined } : { themeLive: true, error: undefined, step: undefined });
  },
});

/** Pages Full store created, kept per store so the next store launch updates them instead of adding more. */
export const saveStorePages = internalMutation({
  args: { userId: v.id("users"), pages: v.record(v.string(), v.string()) },
  handler: async (ctx, args) => {
    const conn = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    if (conn) await ctx.db.patch("shopifyConnections", conn._id, { storePages: { ...(conn.storePages ?? {}), ...args.pages } });
  },
});

/** What the theme download (storeThemeHttp.ts) builds the zip from. */
export const themeSource = internalQuery({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const l = await ctx.db.get("launches", args.launchId);
    if (!l || l.mode !== "store" || !l.store || !l.productHandle || !isStoreStyle(l.style)) return null;
    return {
      style: l.style,
      brandName: l.brandName ?? "",
      productHandle: l.productHandle,
      pageHandles: l.pageHandles ?? {},
      store: l.store,
      title: (l.copy as { title?: string } | undefined)?.title ?? "",
      facts: l.facts,
    };
  },
});
