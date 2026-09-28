import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // App users. Also Convex Auth's user table (name/email/image/... are written
  // by the auth library; tokenIdentifier + role are set in auth.ts).
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    customerId: v.optional(v.string()),
    role: v.optional(v.string()), // "admin" | "user"
    avatarUrl: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_customer_id", ["customerId"]),

  // Winning Products: admin-curated examples, plus real winning products
  // auto-discovered from AdLibrary.com's top-performing ads per niche
  products: defineTable({
    title: v.string(),
    description: v.string(),
    imageUrl: v.string(),
    price: v.optional(v.number()),  // suggested retail price in USD — omitted for auto-synced products until priced by Nexscope
    cost: v.optional(v.number()),   // supplier cost in USD — omitted for auto-synced products until priced by Nexscope
    category: v.string(),
    tags: v.array(v.string()),
    aiScore: v.number(),       // 0–100
    saturation: v.string(),    // "Low" | "Medium" | "High" | "Unknown"
    trend: v.string(),         // "Rising" | "Stable" | "Declining"
    supplierUrl: v.string(),
    adExamples: v.array(v.object({
      platform: v.string(),
      impressions: v.string(),
      imageUrl: v.string(),
    })),
    isWinnerOfDay: v.boolean(),
    publishedAt: v.string(),   // ISO 8601 UTC
    source: v.optional(v.string()), // "curated" | "adlibrary_api" | "nexscope_api" — absent means legacy curated row
    priceSource: v.optional(v.string()), // "exact" | "estimated_market" — absent means legacy curated row (exact); "estimated_market" means price/cost are a Nexscope-derived category benchmark, not this exact product's real price
    // PiPiAds-style product metrics (CSV imports, discovery). Optional.
    adsCount: v.optional(v.number()),
    likes: v.optional(v.number()),
    growthPercent: v.optional(v.number()),
    storeUrl: v.optional(v.string()),
    researchUrl: v.optional(v.string()),
    originalPrice: v.optional(v.string()),
    // Which daily auto-pick this product fills ("<source>:<search niche>"),
    // so tomorrow's pick can retire it. See convex/lib/winners.ts.
    winnerSlot: v.optional(v.string()),
  })
    .index("by_category_published", ["category", "publishedAt"])
    .index("by_published", ["publishedAt"])
    .index("by_winner", ["isWinnerOfDay"])
    .index("by_score", ["aiScore"])
    .index("by_ads", ["adsCount"])
    .index("by_likes", ["likes"])
    .index("by_growth", ["growthPercent"])
    .index("by_price", ["price"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["category", "source"] }),

  // User saved/bookmarked products
  savedProducts: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    savedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_user_and_product", ["userId", "productId"]),

  // Ad Spy: ads sourced from Meta Ad Library (EU/UK) or admin-curated (TikTok/global)
  ads: defineTable({
    advertiserName: v.string(),
    platform: v.string(),        // "Facebook" | "Instagram" | "TikTok"
    country: v.string(),         // ISO country code, e.g. "US", "GB", "DE"
    niche: v.string(),
    headline: v.string(),
    bodyText: v.string(),
    creativeUrl: v.string(),     // image or video thumbnail
    landingPageUrl: v.string(),
    spendEstimate: v.string(),   // e.g. "$5K–$10K" — honest ranged estimate, never a fake precise number
    likes: v.number(),
    views: v.string(),           // e.g. "1.2M"
    daysRunning: v.number(),
    aiScore: v.number(),         // 0–100 winning potential
    targeting: v.object({
      ageRange: v.string(),
      gender: v.string(),
      interests: v.array(v.string()),
    }),
    firstSeenAt: v.string(),     // ISO 8601 UTC
    source: v.string(),          // "adlibrary_api" | "apify" | "nexscope" | "extension" | "curated"
    // ── Rich ad data (Minea/PiPiAds-style). All optional: older rows lack them.
    externalKey: v.optional(v.string()),     // source id (AdLibrary ad_key, meta_<archive id>, tiktok_<video id>)
    mediaType: v.optional(v.string()),       // "image" | "video" | "carousel"
    videoUrl: v.optional(v.string()),
    advertiserAvatar: v.optional(v.string()),
    ctaText: v.optional(v.string()),
    impressions: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    lastSeenAt: v.optional(v.string()),      // ISO 8601 UTC
    isActive: v.optional(v.boolean()),
    countries: v.optional(v.array(v.string())), // ISO alpha-2, where the ad runs
    relatedAdsCount: v.optional(v.number()), // copies of the creative running (scaling signal)
    language: v.optional(v.string()),
    adLibraryUrl: v.optional(v.string()),
    audience: v.optional(v.object({
      totalReach: v.optional(v.number()),
      malePct: v.optional(v.number()),
      femalePct: v.optional(v.number()),
      ages: v.array(v.object({ bracket: v.string(), pct: v.number() })),
      countries: v.array(v.object({ code: v.string(), pct: v.number() })),
    })),
  })
    .index("by_first_seen", ["firstSeenAt"])
    .index("by_platform", ["platform"])
    .index("by_niche", ["niche"])
    .index("by_score", ["aiScore"])
    .index("by_impressions", ["impressions"])
    .index("by_likes", ["likes"])
    .index("by_days", ["daysRunning"])
    .index("by_copies", ["relatedAdsCount"])
    .index("by_last_seen", ["lastSeenAt"])
    .index("by_comments", ["comments"])
    .index("by_shares", ["shares"])
    .searchIndex("search_body", { searchField: "bodyText", filterFields: ["platform", "niche", "source"] }),

  // Links an outside record (Nexscope TikTok ad, Apify Meta ad, Nexscope
  // Shopify store) to our own doc, so repeat imports update instead of
  // creating duplicates.
  syncLinks: defineTable({
    kind: v.string(),        // "ad" | "store"
    externalId: v.string(),  // e.g. "tiktok_7401...", "meta_2381...", "shopify:store.dk"
    docId: v.string(),       // Id<"ads"> or Id<"stores"> as a string
    source: v.string(),      // "nexscope" | "apify"
    lastSyncedAt: v.string(),
  }).index("by_kind_external", ["kind", "externalId"]),

  // One row per Apify import run. The random token in the webhook URL proves
  // the callback is for a run we started (no shared secret env var needed).
  // Precomputed counts/facets (filter dropdowns, admin totals) so pages never
  // scan whole tables. Rebuilt a few minutes after imports and once a day.
  siteStats: defineTable({
    key: v.string(),
    data: v.any(),
    updatedAt: v.string(),
  }).index("by_key", ["key"]),

  apifyRuns: defineTable({
    token: v.string(),
    country: v.string(),
    niche: v.string(),
    keyword: v.string(),
    runId: v.optional(v.string()),
    status: v.string(), // "started" | "imported" | "failed"
    createdAt: v.string(),
    result: v.optional(v.string()),
  }).index("by_token", ["token"]),

  // User saved ads (creative library)
  savedAds: defineTable({
    userId: v.id("users"),
    adId: v.id("ads"),
    savedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_user_and_ad", ["userId", "adId"]),

  // Product Research: trending keywords, modeled after Google Trends interest-over-time
  trends: defineTable({
    keyword: v.string(),
    niche: v.string(),
    direction: v.string(),          // "Rising" | "Stable" | "Declining"
    risingPercent: v.number(),      // e.g. 340 means +340% interest growth
    weeklyInterest: v.array(v.number()), // 12 points, 0-100 relative interest
    countryBreakdown: v.array(v.object({
      country: v.string(),          // ISO country code
      interest: v.number(),         // 0-100 relative interest
    })),
    insight: v.string(),            // short research note on why it's trending
    updatedAt: v.string(),          // ISO 8601 UTC
  })
    .index("by_niche", ["niche"])
    .index("by_updated", ["updatedAt"]),

  // Product Research: curated niche explorer
  niches: defineTable({
    name: v.string(),
    icon: v.string(),               // lucide-react icon name
    description: v.string(),
    avgAiScore: v.number(),         // 0-100
    productCount: v.number(),
    trendDirection: v.string(),     // "Rising" | "Stable" | "Declining"
    topCountries: v.array(v.string()),
  }),

  // Product Research: AliExpress-style supplier/sourcing listings
  supplierListings: defineTable({
    title: v.string(),
    imageUrl: v.string(),
    price: v.number(),              // USD unit cost
    orders: v.number(),             // total orders sold (supplier signal)
    rating: v.number(),             // 0-5
    reviewCount: v.number(),
    shippingDays: v.number(),       // estimated shipping time
    storeName: v.string(),
    storeRating: v.number(),        // 0-5
    sellerCount: v.number(),        // number of other sellers/stores offering this product — drives saturation
    niche: v.string(),
    supplierUrl: v.string(),
  })
    .index("by_niche", ["niche"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["niche"] }),

  // Store Tracker: admin-curated Shopify store intelligence profiles
  stores: defineTable({
    name: v.string(),
    url: v.string(),                // shopify store URL
    logoUrl: v.string(),
    niche: v.string(),
    country: v.string(),            // ISO country code
    platform: v.string(),           // "Shopify"
    estimatedRevenueRange: v.string(),  // e.g. "$50K–$100K/mo" — honest ranged estimate, never fake precision
    trafficRange: v.string(),           // e.g. "80K–150K visits/mo"
    activeAdsCount: v.number(),         // number of currently running ads spotted
    bestSellers: v.array(v.object({
      title: v.string(),
      imageUrl: v.string(),
      price: v.number(),
      estSalesRange: v.string(),        // e.g. "1K–3K sold" — honest ranged estimate
    })),
    isHighTraffic: v.boolean(),         // surfaces in "recently spotted" feed
    spottedAt: v.string(),              // ISO 8601 UTC — when this store was first spotted/added
  })
    .index("by_niche", ["niche"])
    .index("by_spotted", ["spottedAt"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["niche"] }),

  // Store Tracker: user watchlist
  trackedStores: defineTable({
    userId: v.id("users"),
    storeId: v.id("stores"),
    trackedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_user_and_store", ["userId", "storeId"]),

  // Alerts: per-user notification feed (new winners, new ads in watched niches, tracked store updates)
  notifications: defineTable({
    userId: v.id("users"),
    type: v.string(),         // "new_winner" | "new_ad" | "store_update"
    title: v.string(),
    body: v.string(),
    link: v.string(),         // in-app route, e.g. "/dashboard/products/abc"
    isRead: v.boolean(),
    createdAt: v.string(),    // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_user_and_read", ["userId", "isRead"]),

  // Alerts: per-user notification preferences
  alertPreferences: defineTable({
    userId: v.id("users"),
    watchedNiches: v.array(v.string()),
    notifyNewWinners: v.boolean(),
    notifyNewAdsInNiches: v.boolean(),
    notifyTrackedStoreUpdates: v.boolean(),
    emailDigestEnabled: v.boolean(),
    updatedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_user", ["userId"]),

  // Push notification identity mapping (Hercules SDK managed subscriptions)
  pushIdentities: defineTable({
    secret: v.string(),
    visitorId: v.string(),
  })
    .index("by_secret", ["secret"])
    .index("by_visitorId", ["visitorId"]),

  // Country Saturation Analyzer: real signal snapshots, computed from our own
  // Ad Spy / Store Tracker / Trends / Supplier data — never fabricated. Accumulates
  // real history over time as users run checks for the same niche+country.
  saturationChecks: defineTable({
    userId: v.optional(v.id("users")),
    productTitle: v.string(),
    niche: v.string(),
    country: v.string(),          // ISO country code, e.g. "DK", "US"
    saturationScore: v.number(),  // 0-100, higher = more saturated
    demandScore: v.number(),      // 0-100, higher = more demand
    opportunityScore: v.number(), // 0-100, higher = better opportunity
    confidenceScore: v.number(),  // 0-100, how much real data backed this check
    signals: v.object({
      localAdvertiserCount: v.number(),
      localActiveAds: v.number(),
      recentLocalAdvertisers30d: v.number(),
      globalAdvertiserCount: v.number(),
      localStoreCount: v.number(),
      localStoreActiveAds: v.number(),
      supplierSellerCount: v.optional(v.number()),
      trendInterest: v.optional(v.number()),
      trendDirection: v.optional(v.string()),
      trendRisingPercent: v.optional(v.number()),
      sourcesAnalyzed: v.array(v.string()),
      sourcesUnavailable: v.array(v.string()),
    }),
    aiSummary: v.string(),
    createdAt: v.string(),        // ISO 8601 UTC
  })
    .index("by_niche_and_country", ["niche", "country"])
    .index("by_created", ["createdAt"]),

  // Ad Spy: dedup map from AdLibrary.com's ad_key to our own ads row, so the
  // recurring sync updates existing ads instead of creating duplicates.
  adlibrarySyncedAds: defineTable({
    externalId: v.string(),   // AdLibrary.com ad_key
    adId: v.id("ads"),
    lastSyncedAt: v.string(), // ISO 8601 UTC
    enrichedAt: v.optional(v.string()), // set once the free ad-detail call ran
  })
    .index("by_external_id", ["externalId"])
    .index("by_enriched", ["enrichedAt"]),

  // Winning Products: auto-discovered from AdLibrary.com's own sync data.
  // Maps AdLibrary's `ad_key` (of the top-performing ad per niche) to our
  // own products row, so re-syncing updates the existing product in place
  // instead of creating duplicates.
  productSyncedItems: defineTable({
    externalId: v.string(),   // AdLibrary.com ad_key of the source ad
    productId: v.id("products"),
    lastSyncedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_external_id", ["externalId"]),

  // Winning Products: real Amazon bestseller candidates discovered from
  // Nexscope.ai per niche. Maps Amazon's ASIN to our own products row, so
  // re-syncing updates the existing product in place instead of creating
  // duplicates.
  nexscopeSyncedProducts: defineTable({
    externalId: v.string(),   // Amazon ASIN of the source listing
    productId: v.id("products"),
    lastSyncedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_external_id", ["externalId"]),

  // Chrome Extension: crowdsourced ad submissions pending admin moderation
  submittedAds: defineTable({
    submitterVisitorId: v.string(),  // anonymous extension install id, never a real identity
    advertiserName: v.string(),
    platform: v.string(),            // "Facebook" | "Instagram" | "TikTok"
    headline: v.string(),
    bodyText: v.string(),
    creativeUrl: v.string(),
    landingPageUrl: v.string(),
    sourceUrl: v.string(),           // page URL the ad was spotted on
    status: v.string(),              // "pending" | "approved" | "rejected"
    submittedAt: v.string(),         // ISO 8601 UTC
    // Rich data the extension scrapes (all optional: older rows lack them).
    adKey: v.optional(v.string()),           // stable id: "meta_<archive id>" or "ext:<extension key>" — dedupes submissions and approved ads
    videoUrl: v.optional(v.string()),
    ctaText: v.optional(v.string()),
    advertiserAvatar: v.optional(v.string()),
    mediaType: v.optional(v.string()),       // "image" | "video" | "carousel"
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    impressions: v.optional(v.number()),
    countries: v.optional(v.array(v.string())), // ISO alpha-2
    isActive: v.optional(v.boolean()),
    startedAt: v.optional(v.string()),       // ISO 8601 — when the ad started running / was posted
    adLibraryUrl: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_submitted", ["submittedAt"])
    .index("by_ad_key", ["adKey"]),
});
