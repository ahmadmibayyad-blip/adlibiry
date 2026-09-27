import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { paginateFilteredArray } from "./lib/pagination";
import { parseRangeUpperBound } from "./lib/rangeParsing";
import { stableToken } from "./lib/authIdentity";

// ── Ads ───────────────────────────────────────────────────────────────────

export const list = query({
  args: {
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
    sort: v.optional(v.string()), // "newest" | "mostLiked" | "highestSpend" | "longestRunning" | "impressions" | "comments" | "shares" | "lastSeen" | "copies" | "score"
    mediaType: v.optional(v.string()), // "video" | "image" | "carousel"
    activeOnly: v.optional(v.boolean()),
    firstSeenWithinDays: v.optional(v.number()),
    maxDaysRunning: v.optional(v.number()),
    minImpressions: v.optional(v.number()),
    minComments: v.optional(v.number()),
    cta: v.optional(v.string()),
    minCopies: v.optional(v.number()),
    hasLandingPage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Candidate set is every ad newest-first, bounded to a size that's safe
    // to filter in memory — matches the current small (low hundreds) scale
    // of AdSpy Pro's synced ad data. All filters apply before pagination so
    // pages are always fully filtered, never partially filtered then sliced.
    const candidates = await ctx.db.query("ads").withIndex("by_first_seen").order("desc").take(3000);

    let filtered = candidates;
    if (args.platform) filtered = filtered.filter((a) => a.platform === args.platform);
    if (args.niche) filtered = filtered.filter((a) => a.niche === args.niche);
    if (args.country) filtered = filtered.filter((a) => a.country === args.country || (a.countries ?? []).includes(args.country!));
    if (args.search) {
      const term = args.search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.advertiserName.toLowerCase().includes(term) ||
          a.headline.toLowerCase().includes(term) ||
          a.niche.toLowerCase().includes(term)
      );
    }
    if (args.minDaysRunning !== undefined) {
      filtered = filtered.filter((a) => a.daysRunning >= args.minDaysRunning!);
    }
    if (args.minLikes !== undefined) {
      filtered = filtered.filter((a) => a.likes >= args.minLikes!);
    }
    if (args.minSpend !== undefined) {
      filtered = filtered.filter((a) => {
        const ceiling = parseRangeUpperBound(a.spendEstimate);
        return ceiling !== undefined && ceiling >= args.minSpend!;
      });
    }
    if (args.minAiScore !== undefined) {
      filtered = filtered.filter((a) => a.aiScore >= args.minAiScore!);
    }
    if (args.source) {
      filtered = filtered.filter((a) => a.source === args.source);
    }
    if (args.gender) {
      filtered = filtered.filter((a) => a.targeting.gender === args.gender);
    }
    if (args.mediaType) filtered = filtered.filter((a) => (a.mediaType ?? (a.videoUrl ? "video" : "image")) === args.mediaType);
    if (args.activeOnly) filtered = filtered.filter((a) => a.isActive === true);
    if (args.firstSeenWithinDays !== undefined) {
      const since = Date.now() - args.firstSeenWithinDays * 86_400_000;
      filtered = filtered.filter((a) => Date.parse(a.firstSeenAt) >= since);
    }
    if (args.maxDaysRunning !== undefined) filtered = filtered.filter((a) => a.daysRunning <= args.maxDaysRunning!);
    if (args.minImpressions !== undefined) filtered = filtered.filter((a) => (a.impressions ?? 0) >= args.minImpressions!);
    if (args.minComments !== undefined) filtered = filtered.filter((a) => (a.comments ?? 0) >= args.minComments!);
    if (args.cta) {
      const c = args.cta.toLowerCase();
      filtered = filtered.filter((a) => (a.ctaText ?? "").toLowerCase().includes(c));
    }
    if (args.minCopies !== undefined) filtered = filtered.filter((a) => (a.relatedAdsCount ?? 0) >= args.minCopies!);
    if (args.hasLandingPage) filtered = filtered.filter((a) => !!a.landingPageUrl);

    if (args.sort === "mostLiked") {
      filtered = [...filtered].sort((a, b) => b.likes - a.likes);
    } else if (args.sort === "highestSpend") {
      filtered = [...filtered].sort(
        (a, b) => (parseRangeUpperBound(b.spendEstimate) ?? 0) - (parseRangeUpperBound(a.spendEstimate) ?? 0)
      );
    } else if (args.sort === "longestRunning") {
      filtered = [...filtered].sort((a, b) => b.daysRunning - a.daysRunning);
    } else if (args.sort === "impressions") {
      filtered = [...filtered].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));
    } else if (args.sort === "comments") {
      filtered = [...filtered].sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0));
    } else if (args.sort === "shares") {
      filtered = [...filtered].sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0));
    } else if (args.sort === "lastSeen") {
      filtered = [...filtered].sort((a, b) => Date.parse(b.lastSeenAt ?? b.firstSeenAt) - Date.parse(a.lastSeenAt ?? a.firstSeenAt));
    } else if (args.sort === "copies") {
      filtered = [...filtered].sort((a, b) => (b.relatedAdsCount ?? 0) - (a.relatedAdsCount ?? 0));
    } else if (args.sort === "score") {
      filtered = [...filtered].sort((a, b) => b.aiScore - a.aiScore);
    }
    // "newest" (default) keeps the by_first_seen desc order already applied.

    return paginateFilteredArray(filtered, args.paginationOpts);
  },
});

export const getById = query({
  args: { id: v.id("ads") },
  handler: async (ctx, args) => {
    return await ctx.db.get("ads", args.id);
  },
});

export const getFacets = query({
  args: {},
  handler: async (ctx) => {
    const ads = await ctx.db.query("ads").withIndex("by_first_seen").order("desc").take(3000);
    const count = (vals: (string | undefined)[]) => {
      const m = new Map<string, number>();
      for (const x of vals) if (x) m.set(x, (m.get(x) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
    };
    return {
      total: ads.length,
      ctas: count(ads.map((a) => a.ctaText)).slice(0, 20),
      countries: count(ads.flatMap((a) => [...new Set([a.country, ...(a.countries ?? [])])]).filter((c) => c !== "INTL")),
      niches: count(ads.map((a) => a.niche)),
      platforms: count(ads.map((a) => a.platform)),
      activeCount: ads.filter((a) => a.isActive).length,
      videoCount: ads.filter((a) => (a.mediaType ?? "") === "video" || a.videoUrl).length,
    };
  },
});

export const getNiches = query({
  args: {},
  handler: async (ctx) => {
    const ads = await ctx.db.query("ads").take(500);
    const niches = new Set(ads.map((a) => a.niche));
    return Array.from(niches).sort();
  },
});

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not logged in" });

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
