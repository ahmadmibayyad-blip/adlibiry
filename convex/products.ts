import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { stableToken } from "./lib/authIdentity";
import { requireAdmin } from "./admin/helpers";
import type { SiteStats } from "./stats";

// ── Products ────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    category: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    minMargin: v.optional(v.number()), // percent, 0-100
    minAiScore: v.optional(v.number()), // 0-100
    trend: v.optional(v.string()), // "Rising" | "Stable" | "Declining" | "Unknown"
    saturation: v.optional(v.string()), // "Low" | "Medium" | "High" | "Unknown"
    source: v.optional(v.string()), // "curated" | "adlibrary_api" | "nexscope_api"
    winnerOfDayOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
    sort: v.optional(v.string()), // "newest" | "score" | "ads" | "likes" | "growth" | "priceHigh" | "priceLow" | "margin"
    minAds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Index-backed (see ads.list): pages read only what they scan.
    const conds = (q: any) => {
      const c: any[] = [];
      if (args.category) c.push(q.eq(q.field("category"), args.category));
      if (args.trend) c.push(q.eq(q.field("trend"), args.trend));
      if (args.saturation) c.push(q.eq(q.field("saturation"), args.saturation));
      if (args.source === "curated") c.push(q.or(q.eq(q.field("source"), "curated"), q.eq(q.field("source"), undefined)));
      else if (args.source) c.push(q.eq(q.field("source"), args.source));
      if (args.winnerOfDayOnly) c.push(q.eq(q.field("isWinnerOfDay"), true));
      if (args.minAiScore !== undefined) c.push(q.gte(q.field("aiScore"), args.minAiScore));
      if (args.minPrice !== undefined) c.push(q.gte(q.field("price"), args.minPrice));
      if (args.maxPrice !== undefined) c.push(q.and(q.gt(q.field("price"), 0), q.lte(q.field("price"), args.maxPrice)));
      if (args.minAds !== undefined) c.push(q.gte(q.field("adsCount"), args.minAds));
      return c.length === 0 ? true : c.length === 1 ? c[0] : q.and(...c);
    };

    const term = args.search?.trim();
    let result;
    if (term) {
      result = await ctx.db
        .query("products")
        .withSearchIndex("search_title", (q) => {
          let s = q.search("title", term);
          if (args.category) s = s.eq("category", args.category);
          return s;
        })
        .filter(conds)
        .paginate(args.paginationOpts);
    } else if (args.sort === "priceLow") {
      result = await ctx.db.query("products").withIndex("by_price", (q) => q.gt("price", 0)).order("asc").filter(conds).paginate(args.paginationOpts);
    } else {
      const base = ctx.db.query("products");
      const sorted =
        args.sort === "score" ? base.withIndex("by_score")
        : args.sort === "ads" ? base.withIndex("by_ads")
        : args.sort === "likes" ? base.withIndex("by_likes")
        : args.sort === "growth" ? base.withIndex("by_growth")
        : args.sort === "priceHigh" ? base.withIndex("by_price")
        : args.category && (!args.sort || args.sort === "newest")
          ? base.withIndex("by_category_published", (q) => q.eq("category", args.category!))
          : base.withIndex("by_published");
      result = await sorted.order("desc").filter(conds).paginate(args.paginationOpts);
    }

    let page = result.page;
    if (args.minMargin !== undefined) {
      page = page.filter((p) => p.price !== undefined && p.cost !== undefined && p.price > 0 && ((p.price - p.cost) / p.price) * 100 >= args.minMargin!);
    }
    return { ...result, page };
  },
});

export const getById = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db.get("products", args.id);
  },
});

// Ad Spy: counts real Amazon products (from Nexscope) available per niche, so
// ad cards can show a "real Amazon matches" badge. Nexscope products aren't
// tied to a specific ad (they're discovered per-niche, not per-ad), so the
// link is an honest niche match, not a claim that this exact ad is that exact
// product.
export const nexscopeProductCountsByNiche = query({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").withIndex("by_published").order("desc").take(500);
    const counts: Record<string, number> = {};
    for (const product of products) {
      if (product.source === "nexscope_api") {
        counts[product.category] = (counts[product.category] ?? 0) + 1;
      }
    }
    return counts;
  },
});

// Ad Spy: real Amazon products (from Nexscope) in the same niche as an ad,
// shown in the ad detail view so a dropshipper can jump straight to the real
// product's price and listing data.
export const listNexscopeProductsByNiche = query({
  args: { niche: v.string() },
  handler: async (ctx, args) => {
    const products = await ctx.db.query("products").withIndex("by_published").order("desc").take(500);
    return products
      .filter((product) => product.source === "nexscope_api" && product.category === args.niche)
      .slice(0, 6);
  },
});

export const getWinnersOfDay = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("products")
      .withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true))
      .order("desc")
      .take(6);
  },
});

// ── Saved products ───────────────────────────────────────────────────────────

export const getSaved = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return [];
    const saved = await ctx.db
      .query("savedProducts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    const products = await Promise.all(saved.map((s) => ctx.db.get("products", s.productId)));
    return products.filter(Boolean);
  },
});

export const toggleSave = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const existing = await ctx.db
      .query("savedProducts")
      .withIndex("by_user_and_product", (q) =>
        q.eq("userId", user._id).eq("productId", args.productId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete("savedProducts", existing._id);
      return { saved: false };
    } else {
      await ctx.db.insert("savedProducts", {
        userId: user._id,
        productId: args.productId,
        savedAt: new Date().toISOString(),
      });
      return { saved: true };
    }
  },
});

export const isSaved = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return false;
    const existing = await ctx.db
      .query("savedProducts")
      .withIndex("by_user_and_product", (q) =>
        q.eq("userId", user._id).eq("productId", args.productId)
      )
      .unique();
    return !!existing;
  },
});

// Stats for dashboard home
export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const savedCount = identity
      ? await (async () => {
          const user = await ctx.db
            .query("users")
            .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
            .unique();
          if (!user) return 0;
          const saved = await ctx.db
            .query("savedProducts")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(100);
          return saved.length;
        })()
      : 0;

    // Real counts: the total comes from the precomputed site stats (no table
    // scan); "new this week" counts products actually published in the last 7
    // days (it used to be a made-up min(total, 24)).
    const statsDoc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
    const statsTotal = (statsDoc?.data as SiteStats | undefined)?.products.total;
    const totalProducts = statsTotal ?? (await ctx.db.query("products").take(1000)).length;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const newThisWeek = await ctx.db
      .query("products")
      .withIndex("by_published", (q) => q.gte("publishedAt", weekAgo))
      .take(1000);
    const winnersToday = await ctx.db
      .query("products")
      .withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true))
      .take(1000);

    return {
      totalProducts,
      savedCount,
      winnersToday: winnersToday.length,
      newThisWeek: newThisWeek.length,
    };
  },
});

// Admin: seed products
export const seedProducts = mutation({
  args: {},
  handler: async (ctx) => {
    // Demo rows with made-up metrics — admins only, never any signed-in user.
    await requireAdmin(ctx);

    const existing = await ctx.db.query("products").take(1);
    if (existing.length > 0) return { message: "Already seeded" };

    const now = new Date();
    const products = [
      {
        title: "ProGrip Posture Corrector",
        description: "Adjustable posture corrector with memory foam padding. Trending heavily on Facebook and TikTok with 47 active ads. WFH demand driving consistent sales.",
        imageUrl: "https://images.unsplash.com/photo-1491933382434-500287f9b54b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 49.99,
        cost: 8.40,
        category: "Health & Wellness",
        tags: ["posture", "back pain", "WFH", "trending"],
        aiScore: 91,
        saturation: "Low",
        trend: "Rising",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "Facebook", impressions: "2.4M", imageUrl: "https://images.unsplash.com/photo-1491933382434-500287f9b54b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 0).toISOString(),
      },
      {
        title: "MagFlow Wireless Charger Pad",
        description: "15W fast wireless charger with LED indicator and anti-slip base. Dominates Facebook Reels with clean product videos. Margin is exceptional.",
        imageUrl: "https://images.unsplash.com/photo-1578319439584-104c94d37305?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 39.99,
        cost: 5.20,
        category: "Electronics",
        tags: ["wireless", "charging", "phone accessories", "evergreen"],
        aiScore: 87,
        saturation: "Medium",
        trend: "Stable",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "Facebook", impressions: "5.1M", imageUrl: "https://images.unsplash.com/photo-1578319439584-104c94d37305?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 3600000).toISOString(),
      },
      {
        title: "NovaBuds Pro TWS Earbuds",
        description: "ANC wireless earbuds with 36-hour battery. Exploding on TikTok Shop. 12 competitor stores running ads with ROAS above 3x consistently.",
        imageUrl: "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 69.99,
        cost: 14.80,
        category: "Electronics",
        tags: ["earbuds", "ANC", "audio", "TikTok"],
        aiScore: 84,
        saturation: "Low",
        trend: "Rising",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "TikTok", impressions: "8.3M", imageUrl: "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 7200000).toISOString(),
      },
      {
        title: "AuraGlow LED Strip Set",
        description: "5m smart LED strips with app control and music sync. Strong seasonal demand. 18 winning creatives identified with avg CTR of 4.2%.",
        imageUrl: "https://images.unsplash.com/photo-1542681575-352258e0c854?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 34.99,
        cost: 6.10,
        category: "Home & Living",
        tags: ["LED", "smart home", "room decor", "viral"],
        aiScore: 79,
        saturation: "Medium",
        trend: "Rising",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "Facebook", impressions: "3.7M", imageUrl: "https://images.unsplash.com/photo-1542681575-352258e0c854?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 10800000).toISOString(),
      },
      {
        title: "FlexDesk Laptop Stand",
        description: "Adjustable aluminum laptop stand with cable management. High-converting product with WFH evergreen appeal. 4.8★ on AliExpress.",
        imageUrl: "https://images.unsplash.com/photo-1487014679447-9f8336841d58?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 44.99,
        cost: 9.30,
        category: "Home & Living",
        tags: ["laptop", "WFH", "desk setup", "evergreen"],
        aiScore: 76,
        saturation: "Medium",
        trend: "Stable",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "Facebook", impressions: "1.9M", imageUrl: "https://images.unsplash.com/photo-1487014679447-9f8336841d58?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 14400000).toISOString(),
      },
      {
        title: "PocketPulse Massage Gun",
        description: "Compact percussion massager with 5 attachments. Gym and recovery niche is exploding. Low competition in EU market specifically.",
        imageUrl: "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400",
        price: 79.99,
        cost: 18.50,
        category: "Health & Wellness",
        tags: ["massage", "recovery", "gym", "fitness"],
        aiScore: 82,
        saturation: "Low",
        trend: "Rising",
        supplierUrl: "https://www.aliexpress.com",
        adExamples: [
          { platform: "Facebook", impressions: "4.2M", imageUrl: "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400" },
        ],
        isWinnerOfDay: true,
        publishedAt: new Date(now.getTime() - 18000000).toISOString(),
      },
    ];

    for (const p of products) {
      await ctx.db.insert("products", p);
    }

    return { message: `Seeded ${products.length} products` };
  },
});
