import { ConvexError, v, type ObjectType } from "convex/values";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import type { Expression, FilterBuilder, NamedTableInfo } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import type { SiteStats } from "./stats";
import { parseRangeUpperBound } from "./lib/rangeParsing";
import { stableToken } from "./lib/authIdentity";
import { requireAdmin } from "./admin/helpers";

// ── Ads ───────────────────────────────────────────────────────────────────

const listArgs = {
  paginationOpts: paginationOptsValidator,
  platform: v.optional(v.string()),
  niche: v.optional(v.string()),
  country: v.optional(v.string()),
  search: v.optional(v.string()),
  minDaysRunning: v.optional(v.number()),
  minLikes: v.optional(v.number()),
  minSpend: v.optional(v.number()), // dollar floor, compared against the ad's honest spend-range ceiling
  minAiScore: v.optional(v.number()), // 0-100
  source: v.optional(v.string()), // "meta_ad_library" | "curated" | "adlibrary_api"
  gender: v.optional(v.string()), // from ad.targeting.gender, e.g. "All", "Male", "Female"
  sort: v.optional(v.string()), // "newest" | "mostLiked" | "highestSpend" | "longestRunning" | "impressions" | "comments" | "shares" | "lastSeen" | "copies" | "score" | "added" (newest in AdSpy Pro)
  mediaType: v.optional(v.string()), // "video" | "image" | "carousel"
  activeOnly: v.optional(v.boolean()),
  firstSeenWithinDays: v.optional(v.number()),
  maxDaysRunning: v.optional(v.number()),
  minImpressions: v.optional(v.number()),
  minComments: v.optional(v.number()),
  cta: v.optional(v.string()),
  minCopies: v.optional(v.number()),
  hasLandingPage: v.optional(v.boolean()),
  // WinningHunter/PiPiAds-style range filters
  lastSeenWithinDays: v.optional(v.number()),
  maxImpressions: v.optional(v.number()),
  maxLikes: v.optional(v.number()),
  maxSpend: v.optional(v.number()),
  language: v.optional(v.string()),
};

const listImpl = async (ctx: QueryCtx, args: ObjectType<typeof listArgs>) => {
  // Index-backed: each page reads only the ads it scans, never the whole
  // table. Simple filters run inside the database query; the few that
  // can't (multi-country match, CTA text, spend range) trim the page after.
  const conds = (q: FilterBuilder<NamedTableInfo<DataModel, "ads">>) => {
    const c: Expression<boolean>[] = [];
    if (args.platform) c.push(q.eq(q.field("platform"), args.platform));
    if (args.niche) c.push(q.eq(q.field("niche"), args.niche));
    if (args.source) c.push(q.eq(q.field("source"), args.source));
    if (args.gender) c.push(q.eq(q.field("targeting.gender"), args.gender));
    if (args.minDaysRunning !== undefined) c.push(q.gte(q.field("daysRunning"), args.minDaysRunning));
    if (args.maxDaysRunning !== undefined) c.push(q.lte(q.field("daysRunning"), args.maxDaysRunning));
    if (args.minLikes !== undefined) c.push(q.gte(q.field("likes"), args.minLikes));
    if (args.minAiScore !== undefined) c.push(q.gte(q.field("aiScore"), args.minAiScore));
    if (args.mediaType) c.push(q.eq(q.field("mediaType"), args.mediaType));
    if (args.activeOnly) c.push(q.eq(q.field("isActive"), true));
    if (args.firstSeenWithinDays !== undefined)
      c.push(q.gte(q.field("firstSeenAt"), new Date(Date.now() - args.firstSeenWithinDays * 86_400_000).toISOString()));
    if (args.minImpressions !== undefined) c.push(q.gte(q.field("impressions"), args.minImpressions));
    if (args.minComments !== undefined) c.push(q.gte(q.field("comments"), args.minComments));
    if (args.minCopies !== undefined) c.push(q.gte(q.field("relatedAdsCount"), args.minCopies));
    if (args.hasLandingPage) c.push(q.neq(q.field("landingPageUrl"), ""));
    if (args.lastSeenWithinDays !== undefined)
      c.push(q.gte(q.field("lastSeenAt"), new Date(Date.now() - args.lastSeenWithinDays * 86_400_000).toISOString()));
    // A missing value sorts below every number, so "at most X" must also
    // require the field to exist — ads with no data aren't "under 10K".
    if (args.maxImpressions !== undefined)
      c.push(q.and(q.neq(q.field("impressions"), undefined), q.lte(q.field("impressions"), args.maxImpressions)));
    if (args.maxLikes !== undefined) c.push(q.lte(q.field("likes"), args.maxLikes));
    if (args.language) c.push(q.eq(q.field("language"), args.language));
    return c.length === 0 ? true : c.length === 1 ? c[0] : q.and(...c);
  };

  const term = args.search?.trim();
  let result;
  if (term) {
    result = await ctx.db
      .query("ads")
      .withSearchIndex("search_body", (q) => {
        let s = q.search("bodyText", term);
        if (args.platform) s = s.eq("platform", args.platform);
        if (args.niche) s = s.eq("niche", args.niche);
        if (args.source) s = s.eq("source", args.source);
        return s;
      })
      .filter(conds)
      .paginate(args.paginationOpts);
  } else {
    const base = ctx.db.query("ads");
    const sorted =
      args.sort === "score" ? base.withIndex("by_score")
      : args.sort === "impressions" || args.sort === "highestSpend" ? base.withIndex("by_impressions")
      : args.sort === "mostLiked" ? base.withIndex("by_likes")
      : args.sort === "longestRunning" ? base.withIndex("by_days")
      : args.sort === "copies" ? base.withIndex("by_copies")
      : args.sort === "lastSeen" ? base.withIndex("by_last_seen")
      : args.sort === "comments" ? base.withIndex("by_comments")
      : args.sort === "shares" ? base.withIndex("by_shares")
      : args.sort === "added" ? base.withIndex("by_creation_time")
      : base.withIndex("by_first_seen");
    result = await sorted.order("desc").filter(conds).paginate(args.paginationOpts);
  }

  let page = result.page;
  if (args.country) page = page.filter((a) => a.country === args.country || (a.countries ?? []).includes(args.country!));
  if (args.cta) {
    const c = args.cta.toLowerCase();
    page = page.filter((a) => (a.ctaText ?? "").toLowerCase().includes(c));
  }
  if (args.minSpend !== undefined) {
    page = page.filter((a) => (parseRangeUpperBound(a.spendEstimate) ?? 0) >= args.minSpend!);
  }
  if (args.maxSpend !== undefined) {
    // Ads with no spend estimate can't be shown as "under $X".
    page = page.filter((a) => {
      const s = parseRangeUpperBound(a.spendEstimate);
      return s !== undefined && s <= args.maxSpend!;
    });
  }
  return { ...result, page };
};

export const list = query({
  args: listArgs,
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await listImpl(ctx, args);
  },
});

// Same data for backend code that runs without a signed-in user (agents, assistant tools, MCP).
export const listInternal = internalQuery({ args: listArgs, handler: listImpl });

export const getById = query({
  args: { id: v.id("ads") },
  handler: async (ctx, args) => {
    await requireSignedIn(ctx);
    return await ctx.db.get("ads", args.id);
  },
});

export const getFacets = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
    const a = (doc?.data as SiteStats | undefined)?.ads;
    return { languages: [], ...(a ?? { total: 0, activeCount: 0, videoCount: 0, ctas: [], countries: [], niches: [], platforms: [] }) };
  },
});

const getNichesArgs = {};

const getNichesImpl = async (ctx: QueryCtx) => {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "main")).unique();
  return ((doc?.data as SiteStats | undefined)?.ads.niches ?? []).map((n) => n.value).sort();
};

export const getNiches = query({
  args: getNichesArgs,
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    return await getNichesImpl(ctx);
  },
});

// Same data for backend code that runs without a signed-in user (agents, assistant tools, MCP).
export const getNichesInternal = internalQuery({ args: getNichesArgs, handler: getNichesImpl });

// ── Saved ads (creative library) ────────────────────────────────────────────

export const getSavedAds = query({
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
      .query("savedAds")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    const ads = await Promise.all(saved.map((s) => ctx.db.get("ads", s.adId)));
    return ads.filter(Boolean);
  },
});

export const toggleSaveAd = mutation({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });

    const existing = await ctx.db
      .query("savedAds")
      .withIndex("by_user_and_ad", (q) => q.eq("userId", user._id).eq("adId", args.adId))
      .unique();

    if (existing) {
      await ctx.db.delete("savedAds", existing._id);
      return { saved: false };
    } else {
      await ctx.db.insert("savedAds", {
        userId: user._id,
        adId: args.adId,
        savedAt: new Date().toISOString(),
      });
      return { saved: true };
    }
  },
});

export const isAdSaved = query({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
      .unique();
    if (!user) return false;
    const existing = await ctx.db
      .query("savedAds")
      .withIndex("by_user_and_ad", (q) => q.eq("userId", user._id).eq("adId", args.adId))
      .unique();
    return !!existing;
  },
});

// Dev/demo seed — admin curated ads covering Facebook, Instagram, TikTok
export const seedAds = mutation({
  args: {},
  handler: async (ctx) => {
    // Demo rows with made-up metrics — admins only, never any signed-in user.
    await requireAdmin(ctx);

    const existing = await ctx.db.query("ads").take(1);
    if (existing.length > 0) return { message: "Already seeded" };

    const now = Date.now();
    const ads = [
      {
        advertiserName: "PosturePro Official",
        platform: "Facebook",
        country: "US",
        niche: "Health & Wellness",
        headline: "Fix Your Posture in 30 Days — Doctors Recommend This",
        bodyText: "Stop slouching. This adjustable corrector realigns your spine while you work, drive, or walk. 90-day money-back guarantee.",
        creativeUrl: "https://images.unsplash.com/photo-1491933382434-500287f9b54b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/posture-pro",
        spendEstimate: "$15K–$25K/mo",
        likes: 4820,
        views: "2.4M",
        daysRunning: 47,
        aiScore: 91,
        targeting: { ageRange: "35–54", gender: "All", interests: ["Chiropractic", "Ergonomics", "Remote work"] },
        firstSeenAt: new Date(now - 47 * 86400000).toISOString(),
        source: "meta_ad_library",
      },
      {
        advertiserName: "ChargeFlow",
        platform: "Instagram",
        country: "GB",
        niche: "Electronics",
        headline: "Charge 3 Devices at Once — No More Cable Chaos",
        bodyText: "15W fast wireless charging pad with LED status ring. Sleek enough for any desk. Ships in 2 days.",
        creativeUrl: "https://images.unsplash.com/photo-1578319439584-104c94d37305?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/chargeflow",
        spendEstimate: "$8K–$15K/mo",
        likes: 2140,
        views: "1.1M",
        daysRunning: 23,
        aiScore: 84,
        targeting: { ageRange: "25–44", gender: "All", interests: ["Gadgets", "Tech accessories"] },
        firstSeenAt: new Date(now - 23 * 86400000).toISOString(),
        source: "meta_ad_library",
      },
      {
        advertiserName: "NovaSound",
        platform: "TikTok",
        country: "US",
        niche: "Electronics",
        headline: "These earbuds went viral for a reason 🎧",
        bodyText: "36-hour battery, ANC, and they actually stay in during workouts. Link in bio for 40% off today only.",
        creativeUrl: "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/novasound",
        spendEstimate: "$20K–$40K/mo",
        likes: 18400,
        views: "8.3M",
        daysRunning: 12,
        aiScore: 88,
        targeting: { ageRange: "18–34", gender: "All", interests: ["Music", "Fitness", "TikTok Shop"] },
        firstSeenAt: new Date(now - 12 * 86400000).toISOString(),
        source: "curated",
      },
      {
        advertiserName: "GlowRoom Co.",
        platform: "Facebook",
        country: "DE",
        niche: "Home & Living",
        headline: "Transform Your Room in 10 Minutes",
        bodyText: "App-controlled LED strips that sync to your music. 16 million colors. Rated 4.8 stars by 12,000+ customers.",
        creativeUrl: "https://images.unsplash.com/photo-1542681575-352258e0c854?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/glowroom",
        spendEstimate: "$10K–$18K/mo",
        likes: 3560,
        views: "1.8M",
        daysRunning: 34,
        aiScore: 79,
        targeting: { ageRange: "18–34", gender: "All", interests: ["Room decor", "Gaming", "Aesthetic"] },
        firstSeenAt: new Date(now - 34 * 86400000).toISOString(),
        source: "meta_ad_library",
      },
      {
        advertiserName: "DeskWorks",
        platform: "Instagram",
        country: "US",
        niche: "Home & Living",
        headline: "Your Laptop Deserves Better Than a Flat Table",
        bodyText: "Aluminum stand with built-in cable management. Reduces neck strain. Free shipping this week.",
        creativeUrl: "https://images.unsplash.com/photo-1487014679447-9f8336841d58?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/deskworks",
        spendEstimate: "$4K–$8K/mo",
        likes: 980,
        views: "540K",
        daysRunning: 61,
        aiScore: 74,
        targeting: { ageRange: "25–44", gender: "All", interests: ["Remote work", "Office setup"] },
        firstSeenAt: new Date(now - 61 * 86400000).toISOString(),
        source: "meta_ad_library",
      },
      {
        advertiserName: "RecoverFast",
        platform: "TikTok",
        country: "GB",
        niche: "Health & Wellness",
        headline: "Athletes swear by this recovery hack",
        bodyText: "Percussion massage gun with 5 attachments. Quiet motor so you can use it anywhere. 30-day trial.",
        creativeUrl: "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=500",
        landingPageUrl: "https://example.com/recoverfast",
        spendEstimate: "$12K–$20K/mo",
        likes: 7230,
        views: "3.9M",
        daysRunning: 8,
        aiScore: 86,
        targeting: { ageRange: "18–44", gender: "All", interests: ["Gym", "Fitness recovery", "Sports"] },
        firstSeenAt: new Date(now - 8 * 86400000).toISOString(),
        source: "curated",
      },
    ];

    for (const ad of ads) {
      await ctx.db.insert("ads", ad);
    }

    return { message: `Seeded ${ads.length} ads` };
  },
});

// Public: the homepage's "Look inside any ad" section. Three running image ads
// with the most reach, one per advertiser and niche, limited to the fields shown.
export const homepagePreview = query({
  args: {},
  handler: async (ctx) => {
    const { page } = await listImpl(ctx, {
      paginationOpts: { numItems: 40, cursor: null },
      sort: "impressions",
      activeOnly: true,
      mediaType: "image",
    });
    return page
      .filter((a) => a.creativeUrl)
      .filter((a, i, all) => all.findIndex((b) => b.advertiserName === a.advertiserName || b.niche === a.niche) === i)
      .slice(0, 3)
      .map((a) => ({
        _id: a._id,
        advertiserName: a.advertiserName,
        niche: a.niche,
        platform: a.platform,
        country: a.country,
        creativeUrl: a.creativeUrl,
        aiScore: a.aiScore,
        spendEstimate: a.spendEstimate,
        impressions: a.impressions,
        views: a.views,
        daysRunning: a.daysRunning,
      }));
  },
});
