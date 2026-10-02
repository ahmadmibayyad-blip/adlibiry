import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { paginateFilteredArray } from "./lib/pagination";
import { parseRangeUpperBound } from "./lib/rangeParsing";
import { stableToken } from "./lib/authIdentity";
import { requireAdmin } from "./admin/helpers";

// ── Store search & profiles ─────────────────────────────────────────────────

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    niche: v.optional(v.string()),
    minRevenue: v.optional(v.number()), // dollar floor, compared against the store's honest revenue-range ceiling
    minTraffic: v.optional(v.number()), // monthly-visit floor, compared against the store's honest traffic-range ceiling
    minActiveAds: v.optional(v.number()),
    country: v.optional(v.string()), // ISO country code
    highTrafficOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const hasNumericFilters =
      args.minRevenue !== undefined ||
      args.minTraffic !== undefined ||
      args.minActiveAds !== undefined ||
      args.country !== undefined ||
      args.highTrafficOnly;

    if (!hasNumericFilters) {
      if (args.search) {
        return await ctx.db
          .query("stores")
          .withSearchIndex("search_name", (q) =>
            args.niche ? q.search("name", args.search!).eq("niche", args.niche) : q.search("name", args.search!)
          )
          .paginate(args.paginationOpts);
      }

      const q = ctx.db.query("stores");
      if (args.niche) {
        return await q.withIndex("by_niche", (idx) => idx.eq("niche", args.niche!)).paginate(args.paginationOpts);
      }
      return await q.withIndex("by_spotted").order("desc").paginate(args.paginationOpts);
    }

    // Revenue/traffic/ad-count filters can't use an index (they're parsed
    // from honest ranged-estimate strings, not stored as plain numbers), so
    // fetch a bounded candidate set, filter fully, then paginate the
    // filtered array — never paginate first and filter after.
    const candidates = await ctx.db.query("stores").withIndex("by_spotted").order("desc").take(1000);

    let filtered = candidates;
    if (args.niche) filtered = filtered.filter((s) => s.niche === args.niche);
    if (args.country) filtered = filtered.filter((s) => s.country === args.country);
    if (args.highTrafficOnly) filtered = filtered.filter((s) => s.isHighTraffic);
    if (args.search) {
      const term = args.search.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(term) || s.url.toLowerCase().includes(term));
    }
    if (args.minActiveAds !== undefined) {
      filtered = filtered.filter((s) => s.activeAdsCount >= args.minActiveAds!);
    }
    if (args.minRevenue !== undefined) {
      filtered = filtered.filter((s) => {
        const ceiling = parseRangeUpperBound(s.estimatedRevenueRange);
        return ceiling !== undefined && ceiling >= args.minRevenue!;
      });
    }
    if (args.minTraffic !== undefined) {
      filtered = filtered.filter((s) => {
        const ceiling = parseRangeUpperBound(s.trafficRange);
        return ceiling !== undefined && ceiling >= args.minTraffic!;
      });
    }

    return paginateFilteredArray(filtered, args.paginationOpts);
  },
});

export const getById = query({
  args: { id: v.id("stores") },
  handler: async (ctx, args) => {
    return await ctx.db.get("stores", args.id);
  },
});

export const getNiches = query({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query("stores").take(500);
    const niches = new Set(stores.map((s) => s.niche));
    return Array.from(niches).sort();
  },
});

// Recently spotted high-traffic stores feed
export const getRecentlySpotted = query({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query("stores").withIndex("by_spotted").order("desc").take(50);
    return stores.filter((s) => s.isHighTraffic).slice(0, 8);
  },
});

// Stores added by Nexscope product discovery (newest first). Older rows are
// recognised by the site-icon logo discovery gave them before `source` existed.
export const getNewlyDiscovered = query({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query("stores").withIndex("by_spotted").order("desc").take(300);
    return stores.filter((s) => s.source === "product_discovery" || s.logoUrl.includes("google.com/s2/favicons")).slice(0, 12);
  },
});

// Compare up to 4 stores side by side
export const getByIds = query({
  args: { ids: v.array(v.id("stores")) },
  handler: async (ctx, args) => {
    const stores = await Promise.all(args.ids.map((id) => ctx.db.get("stores", id)));
    return stores.filter(Boolean);
  },
});

// ── Watchlist (tracked stores) ───────────────────────────────────────────────

export const getTrackedStores = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return [];
    const tracked = await ctx.db
      .query("trackedStores")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    const stores = await Promise.all(tracked.map((t) => ctx.db.get("stores", t.storeId)));
    return stores.filter(Boolean);
  },
});

export const toggleTrackStore = mutation({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const existing = await ctx.db
      .query("trackedStores")
      .withIndex("by_user_and_store", (q) => q.eq("userId", user._id).eq("storeId", args.storeId))
      .unique();

    if (existing) {
      await ctx.db.delete("trackedStores", existing._id);
      return { tracked: false };
    } else {
      await ctx.db.insert("trackedStores", {
        userId: user._id,
        storeId: args.storeId,
        trackedAt: new Date().toISOString(),
      });
      return { tracked: true };
    }
  },
});

export const isStoreTracked = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return false;
    const existing = await ctx.db
      .query("trackedStores")
      .withIndex("by_user_and_store", (q) => q.eq("userId", user._id).eq("storeId", args.storeId))
      .unique();
    return !!existing;
  },
});

// ── Dev/demo seed — admin curated Shopify store intelligence profiles ──────

export const seedStores = mutation({
  args: {},
  handler: async (ctx) => {
    // Demo rows with made-up metrics — admins only, never any signed-in user.
    await requireAdmin(ctx);

    const existing = await ctx.db.query("stores").take(1);
    if (existing.length > 0) return { message: "Already seeded" };

    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();

    const stores = [
      {
        name: "ErgoLife Co.",
        url: "https://ergolife.co",
        logoUrl: "https://images.unsplash.com/photo-1491933382434-500287f9b54b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Health & Wellness",
        country: "US",
        platform: "Shopify",
        estimatedRevenueRange: "$80K–$150K/mo",
        trafficRange: "120K–200K visits/mo",
        activeAdsCount: 14,
        bestSellers: [
          { title: "Adjustable Posture Corrector Brace", imageUrl: "https://images.unsplash.com/photo-1491933382434-500287f9b54b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 39.99, estSalesRange: "3K–6K sold" },
          { title: "Memory Foam Lumbar Support Pillow", imageUrl: "https://images.unsplash.com/photo-1587355760421-b9de3226a046?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 29.99, estSalesRange: "1K–3K sold" },
        ],
        isHighTraffic: true,
        spottedAt: daysAgo(1),
      },
      {
        name: "ChargeTech Direct",
        url: "https://chargetechdirect.com",
        logoUrl: "https://images.unsplash.com/photo-1578319439584-104c94d37305?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Electronics",
        country: "GB",
        platform: "Shopify",
        estimatedRevenueRange: "$40K–$80K/mo",
        trafficRange: "60K–100K visits/mo",
        activeAdsCount: 9,
        bestSellers: [
          { title: "15W Fast Wireless Charging Pad", imageUrl: "https://images.unsplash.com/photo-1578319439584-104c94d37305?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 24.99, estSalesRange: "2K–4K sold" },
          { title: "3-in-1 Magnetic Charging Station", imageUrl: "https://images.unsplash.com/photo-1591290619762-361a3e565816?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 44.99, estSalesRange: "800–2K sold" },
        ],
        isHighTraffic: true,
        spottedAt: daysAgo(2),
      },
      {
        name: "GlowRoom Co.",
        url: "https://glowroomco.com",
        logoUrl: "https://images.unsplash.com/photo-1542681575-352258e0c854?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Home & Living",
        country: "DE",
        platform: "Shopify",
        estimatedRevenueRange: "$100K–$180K/mo",
        trafficRange: "150K–250K visits/mo",
        activeAdsCount: 21,
        bestSellers: [
          { title: "Smart LED Strip Lights 5M", imageUrl: "https://images.unsplash.com/photo-1542681575-352258e0c854?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 34.99, estSalesRange: "6K–10K sold" },
          { title: "Galaxy Star Projector Light", imageUrl: "https://images.unsplash.com/photo-1517154421773-0529f29ea451?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 27.99, estSalesRange: "2K–5K sold" },
        ],
        isHighTraffic: true,
        spottedAt: daysAgo(0),
      },
      {
        name: "PawCare Supply Co.",
        url: "https://pawcaresupply.com",
        logoUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Pet Supplies",
        country: "US",
        platform: "Shopify",
        estimatedRevenueRange: "$15K–$30K/mo",
        trafficRange: "25K–45K visits/mo",
        activeAdsCount: 5,
        bestSellers: [
          { title: "Portable Pet Grooming Kit — 5-in-1", imageUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 44.99, estSalesRange: "500–1.5K sold" },
        ],
        isHighTraffic: false,
        spottedAt: daysAgo(4),
      },
      {
        name: "GlowSkin Beauty Tech",
        url: "https://glowskinbeauty.com",
        logoUrl: "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Beauty",
        country: "US",
        platform: "Shopify",
        estimatedRevenueRange: "$60K–$110K/mo",
        trafficRange: "90K–150K visits/mo",
        activeAdsCount: 17,
        bestSellers: [
          { title: "LED Photon Therapy Face Mask", imageUrl: "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 59.99, estSalesRange: "2K–4K sold" },
          { title: "Microneedle Skin Roller Set", imageUrl: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 22.99, estSalesRange: "1K–3K sold" },
        ],
        isHighTraffic: true,
        spottedAt: daysAgo(1),
      },
      {
        name: "RecoverPro Fitness",
        url: "https://recoverprofitness.com",
        logoUrl: "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Health & Wellness",
        country: "US",
        platform: "Shopify",
        estimatedRevenueRange: "$50K–$90K/mo",
        trafficRange: "70K–110K visits/mo",
        activeAdsCount: 11,
        bestSellers: [
          { title: "Percussion Massage Gun with 5 Attachments", imageUrl: "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 89.99, estSalesRange: "1K–2K sold" },
        ],
        isHighTraffic: false,
        spottedAt: daysAgo(3),
      },
      {
        name: "DeskWorks Supply",
        url: "https://deskworkssupply.com",
        logoUrl: "https://images.unsplash.com/photo-1487014679447-9f8336841d58?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Home & Living",
        country: "US",
        platform: "Shopify",
        estimatedRevenueRange: "$25K–$45K/mo",
        trafficRange: "40K–65K visits/mo",
        activeAdsCount: 6,
        bestSellers: [
          { title: "Adjustable Aluminum Laptop Stand", imageUrl: "https://images.unsplash.com/photo-1487014679447-9f8336841d58?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 34.99, estSalesRange: "800–2K sold" },
        ],
        isHighTraffic: false,
        spottedAt: daysAgo(5),
      },
      {
        name: "StreetFit Apparel",
        url: "https://streetfitapparel.com",
        logoUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=200",
        niche: "Fashion",
        country: "FR",
        platform: "Shopify",
        estimatedRevenueRange: "$30K–$60K/mo",
        trafficRange: "100K–180K visits/mo",
        activeAdsCount: 8,
        bestSellers: [
          { title: "Graphic Print Oversized Cotton Tee", imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400", price: 19.99, estSalesRange: "3K–6K sold" },
        ],
        isHighTraffic: false,
        spottedAt: daysAgo(6),
      },
    ];

    for (const s of stores) await ctx.db.insert("stores", s);
    return { message: `Seeded ${stores.length} stores` };
  },
});
