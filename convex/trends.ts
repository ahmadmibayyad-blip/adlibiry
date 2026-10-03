import { v, type ObjectType } from "convex/values";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { limitedPage, requireSignedIn, resultLimitFor } from "./lib/access";
import { paginationOptsValidator } from "convex/server";
import { requireAdmin } from "./admin/helpers";

// ── Trending keywords (Google Trends-style) ────────────────────────────────

const listArgs = {
  niche: v.optional(v.string()),
  direction: v.optional(v.string()),
};

const listImpl = async (ctx: QueryCtx, args: ObjectType<typeof listArgs>) => {
  let trends = await ctx.db.query("trends").withIndex("by_updated").order("desc").take(200);
  if (args.niche) trends = trends.filter((t) => t.niche === args.niche);
  if (args.direction) trends = trends.filter((t) => t.direction === args.direction);
  // Rising first (biggest gain first), then steady, then falling.
  const order: Record<string, number> = { Rising: 0, Stable: 1, Declining: 2 };
  return trends.sort((a, b) => (order[a.direction] ?? 3) - (order[b.direction] ?? 3) || b.risingPercent - a.risingPercent);
};

export const list = query({
  args: listArgs,
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    const trends = await listImpl(ctx, args);
    const limit = await resultLimitFor(ctx);
    return limit === null ? trends : trends.slice(0, limit);
  },
});

// Same data for backend code that runs without a signed-in user (agents, assistant tools, MCP).
export const listInternal = internalQuery({ args: listArgs, handler: listImpl });

export const getById = query({
  args: { id: v.id("trends") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await ctx.db.get("trends", args.id);
  },
});

export const getRisingNiches = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const niches = await ctx.db.query("niches").take(50);
    return niches
      .filter((n) => n.trendDirection === "Rising")
      .sort((a, b) => b.avgAiScore - a.avgAiScore)
      .slice(0, 6);
  },
});

// ── Niche explorer ──────────────────────────────────────────────────────────

const listNichesArgs = {};

const listNichesImpl = async (ctx: QueryCtx) => {
  return await ctx.db.query("niches").take(50);
};

export const listNiches = query({
  args: listNichesArgs,
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    return await listNichesImpl(ctx);
  },
});

// Same data for backend code that runs without a signed-in user (agents, assistant tools, MCP).
export const listNichesInternal = internalQuery({ args: listNichesArgs, handler: listNichesImpl });

// ── AliExpress-style supplier search ────────────────────────────────────────

const searchSuppliersArgs = {
  paginationOpts: paginationOptsValidator,
  search: v.optional(v.string()),
  niche: v.optional(v.string()),
};

const searchSuppliersImpl = async (ctx: QueryCtx, args: ObjectType<typeof searchSuppliersArgs>) => {
  if (args.search) {
    return await ctx.db
      .query("supplierListings")
      .withSearchIndex("search_title", (q) =>
        args.niche
          ? q.search("title", args.search!).eq("niche", args.niche)
          : q.search("title", args.search!)
      )
      .paginate(args.paginationOpts);
  }

  let q = ctx.db.query("supplierListings");
  if (args.niche) {
    return await q.withIndex("by_niche", (idx) => idx.eq("niche", args.niche!)).paginate(args.paginationOpts);
  }
  return await q.paginate(args.paginationOpts);
};

export const searchSuppliers = query({
  args: searchSuppliersArgs,
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await limitedPage(ctx, args.paginationOpts, (paginationOpts) => searchSuppliersImpl(ctx, { ...args, paginationOpts }));
  },
});

// Same data for backend code that runs without a signed-in user (agents, assistant tools, MCP).
export const searchSuppliersInternal = internalQuery({ args: searchSuppliersArgs, handler: searchSuppliersImpl });

export const getSupplierById = query({
  args: { id: v.id("supplierListings") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await ctx.db.get("supplierListings", args.id);
  },
});

// ── Dev/demo seed ─────────────────────────────────────────────────────────

export const seedResearchData = mutation({
  args: {},
  handler: async (ctx) => {
    // Demo rows with made-up metrics — admins only, never any signed-in user.
    await requireAdmin(ctx);

    const existing = await ctx.db.query("trends").take(1);
    if (existing.length > 0) return { message: "Already seeded" };

    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

    const niches = [
      { name: "Health & Wellness", icon: "HeartPulse", description: "Recovery tools, posture aids, and self-care gadgets riding the wellness wave.", avgAiScore: 84, productCount: 128, trendDirection: "Rising", topCountries: ["US", "GB", "AU"] },
      { name: "Electronics", icon: "Zap", description: "Chargers, audio, and smart gadgets — consistently high-volume, moderate competition.", avgAiScore: 79, productCount: 214, trendDirection: "Stable", topCountries: ["US", "DE", "GB"] },
      { name: "Home & Living", icon: "Home", description: "Room decor and desk setup products with strong seasonal spikes.", avgAiScore: 74, productCount: 156, trendDirection: "Rising", topCountries: ["US", "DE", "FR"] },
      { name: "Pet Supplies", icon: "Dog", description: "Pet gadgets and grooming tools — underserved niche with low ad saturation.", avgAiScore: 81, productCount: 62, trendDirection: "Rising", topCountries: ["US", "CA", "GB"] },
      { name: "Beauty", icon: "Sparkles", description: "Skincare tools and beauty tech — heavy TikTok virality, fast-moving trends.", avgAiScore: 77, productCount: 189, trendDirection: "Stable", topCountries: ["US", "GB", "AU"] },
      { name: "Fashion", icon: "Shirt", description: "Accessories and apparel add-ons — high volume but thin margins.", avgAiScore: 68, productCount: 241, trendDirection: "Declining", topCountries: ["US", "FR", "IT"] },
    ];
    for (const n of niches) await ctx.db.insert("niches", n);

    const trends = [
      {
        keyword: "posture corrector",
        niche: "Health & Wellness",
        direction: "Rising",
        risingPercent: 340,
        weeklyInterest: [20, 24, 28, 31, 38, 45, 52, 61, 70, 78, 88, 96],
        countryBreakdown: [
          { country: "US", interest: 96 },
          { country: "GB", interest: 78 },
          { country: "AU", interest: 64 },
          { country: "DE", interest: 41 },
        ],
        insight: "Search interest tripled in 12 weeks alongside a wave of WFH ergonomics content on TikTok.",
        updatedAt: daysAgo(0),
      },
      {
        keyword: "led strip lights",
        niche: "Home & Living",
        direction: "Rising",
        risingPercent: 180,
        weeklyInterest: [40, 42, 45, 48, 55, 60, 68, 74, 82, 88, 91, 95],
        countryBreakdown: [
          { country: "US", interest: 95 },
          { country: "DE", interest: 72 },
          { country: "FR", interest: 58 },
          { country: "GB", interest: 51 },
        ],
        insight: "Room makeover content and gaming setup aesthetics are driving sustained seasonal growth.",
        updatedAt: daysAgo(0),
      },
      {
        keyword: "wireless charging pad",
        niche: "Electronics",
        direction: "Stable",
        risingPercent: 12,
        weeklyInterest: [58, 60, 57, 61, 59, 62, 60, 63, 61, 64, 62, 65],
        countryBreakdown: [
          { country: "US", interest: 65 },
          { country: "GB", interest: 54 },
          { country: "DE", interest: 49 },
        ],
        insight: "Evergreen accessory — steady demand, no major seasonal swings, safe long-term pick.",
        updatedAt: daysAgo(1),
      },
      {
        keyword: "dog grooming kit",
        niche: "Pet Supplies",
        direction: "Rising",
        risingPercent: 210,
        weeklyInterest: [15, 18, 22, 26, 33, 40, 49, 58, 66, 75, 84, 91],
        countryBreakdown: [
          { country: "US", interest: 91 },
          { country: "CA", interest: 68 },
          { country: "GB", interest: 55 },
        ],
        insight: "At-home pet grooming surged as inflation pushed owners away from professional groomers.",
        updatedAt: daysAgo(1),
      },
      {
        keyword: "led face mask",
        niche: "Beauty",
        direction: "Stable",
        risingPercent: 8,
        weeklyInterest: [50, 52, 49, 53, 51, 54, 52, 55, 53, 56, 54, 57],
        countryBreakdown: [
          { country: "US", interest: 57 },
          { country: "GB", interest: 46 },
          { country: "AU", interest: 44 },
        ],
        insight: "Mature trend with consistent creator content — good margin, moderate saturation.",
        updatedAt: daysAgo(2),
      },
      {
        keyword: "graphic tees",
        niche: "Fashion",
        direction: "Declining",
        risingPercent: -34,
        weeklyInterest: [80, 76, 71, 68, 62, 58, 53, 49, 44, 40, 36, 33],
        countryBreakdown: [
          { country: "US", interest: 33 },
          { country: "FR", interest: 28 },
          { country: "IT", interest: 25 },
        ],
        insight: "Interest cooling as fast-fashion apparel niches face rising ad costs and thin margins.",
        updatedAt: daysAgo(2),
      },
      {
        keyword: "massage gun",
        niche: "Health & Wellness",
        direction: "Rising",
        risingPercent: 95,
        weeklyInterest: [45, 48, 50, 54, 58, 63, 68, 72, 78, 83, 88, 92],
        countryBreakdown: [
          { country: "US", interest: 92 },
          { country: "GB", interest: 70 },
          { country: "DE", interest: 62 },
        ],
        insight: "Recovery and mobility content from fitness creators is compounding demand quarter over quarter.",
        updatedAt: daysAgo(3),
      },
      {
        keyword: "phone camera lens kit",
        niche: "Electronics",
        direction: "Declining",
        risingPercent: -18,
        weeklyInterest: [70, 68, 64, 60, 57, 53, 50, 47, 44, 41, 38, 36],
        countryBreakdown: [
          { country: "US", interest: 36 },
          { country: "GB", interest: 30 },
        ],
        insight: "Native phone camera quality improvements are shrinking demand for add-on lens kits.",
        updatedAt: daysAgo(3),
      },
    ];
    for (const t of trends) await ctx.db.insert("trends", t);


    return { message: `Seeded ${niches.length} niches, ${trends.length} trends` };
  },
});
