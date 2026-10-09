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
    customerId: v.optional(v.string()), // Stripe customer ID
    // Set by the Stripe webhook (convex/billing.ts applySubscription).
    plan: v.optional(v.string()), // "starter" | "pro" | "agency" | "none"
    subscriptionStatus: v.optional(v.string()), // Stripe status: "trialing", "active", "past_due", "canceled", …
    subscriptionId: v.optional(v.string()),
    planRenewsAt: v.optional(v.number()), // ms
    displayCurrency: v.optional(v.string()), // "USD" | "EUR" | "GBP" | "DKK" (lib/currency.ts)
    // Onboarding (convex/onboarding.ts): the niches they sell in pre-filter the
    // app; the timezone times their morning digest.
    niches: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()), // IANA, e.g. "Europe/Copenhagen"
    targetCountry: v.optional(v.string()), // ISO code of the market they sell to (verdict panel's "Room left")
    onboardedAt: v.optional(v.string()),
    proTrialEndsAt: v.optional(v.number()), // ms; set once when the 7-day Pro trial starts (lib/billing.ts)
    subscriptionEventAt: v.optional(v.number()), // Stripe event.created (s) of the last applied change
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
    source: v.optional(v.string()), // "curated" | "adlibrary_api" | "nexscope_api" (Amazon) | "tiktok_shop" | "shopify" — absent means legacy curated row
    priceSource: v.optional(v.string()), // "exact" | "estimated_market" — absent means legacy curated row (exact); "estimated_market" means price/cost are a Nexscope-derived category benchmark, not this exact product's real price
    // PiPiAds-style product metrics (CSV imports, discovery). Optional.
    adsCount: v.optional(v.number()),
    likes: v.optional(v.number()),
    growthPercent: v.optional(v.number()),
    storeUrl: v.optional(v.string()),
    researchUrl: v.optional(v.string()),
    originalPrice: v.optional(v.string()),
    priceCheckedAt: v.optional(v.string()), // last time the product page was checked for a price (convex/priceFetch.ts)
    // Which daily auto-pick this product fills ("<source>:<search niche>"),
    // so tomorrow's pick can retire it. See convex/lib/winners.ts.
    winnerSlot: v.optional(v.string()),
    // ── Linked ads (convex/productPipeline.ts). Products "from ads" are built
    // from running ads that sell a physical product; several ads for the same
    // product share one product row.
    urlKey: v.optional(v.string()),     // normalised product-page URL, for matching
    titleKey: v.optional(v.string()),   // normalised title, for matching
    adIds: v.optional(v.array(v.id("ads"))),
    linkedAds: v.optional(v.number()),  // number of linked ads (0/absent = product DB only)
    linkedViews: v.optional(v.number()),
    linkedComments: v.optional(v.number()),
    linkedSpend: v.optional(v.number()), // est. ad spend, upper bound, USD
    linkedGmv: v.optional(v.number()),
    // Modelled numbers (convex/lib/estimates.ts), set by the daily pipeline.
    unitsPerMonth: v.optional(v.number()),   // orders/month from the marketplace's own data (Amazon clicks × conversion, Shopify weekly orders, TikTok Shop daily sales)
    estImpressions: v.optional(v.object({ low: v.number(), high: v.number() })),
    estAdSpend: v.optional(v.object({ low: v.number(), high: v.number() })),
    estRevenue: v.optional(v.object({ low: v.number(), high: v.number() })), // per month, USD
    estBasis: v.optional(v.object({ impressions: v.optional(v.string()), adSpend: v.optional(v.string()), revenue: v.optional(v.string()) })),
    marginPercent: v.optional(v.number()),
    // Kept out of Winning Products; hideable in Products.
    isBigBrand: v.optional(v.boolean()),
    isPersonalised: v.optional(v.boolean()),
    isService: v.optional(v.boolean()),
    // Winning Products (rebuilt daily): rank inside its niche, absent if not in the list.
    winnerRank: v.optional(v.number()),
    // More photos from the product's store page (convex/productImages.ts).
    images: v.optional(v.array(v.string())),
    imagesCheckedAt: v.optional(v.string()),
    // Perceptual hash of imageUrl (convex/imageHashAction.ts), the key for
    // spotting one product imported twice from different sources. "" = the
    // image couldn't be read. imageHashUrl is the URL that was hashed, so a
    // new imageUrl gets hashed again.
    imageHash: v.optional(v.string()),
    imageHashUrl: v.optional(v.string()),
    // The hash in four parts, for finding near matches (lib/imageHash.ts hashBands).
    hashBand0: v.optional(v.string()),
    hashBand1: v.optional(v.string()),
    hashBand2: v.optional(v.string()),
    hashBand3: v.optional(v.string()),
    // Score model v2 (lib/productScore.ts): the five parts (0–100), the raw
    // weighted score (0–1), the importer's own score it started from, and the
    // calibrated v2 score (live in aiScore once Admin switches to v2).
    scoreParts: v.optional(v.object({
      momentum: v.number(),
      revenue: v.number(),
      trend: v.number(),
      saturation: v.number(),
      margin: v.number(),
      raw: v.number(),
      source: v.number(),
      v2: v.optional(v.number()),
    })),
    activeAds: v.optional(v.number()),  // ads running now (linked, seen in the last 14 days; else the source's count)
    momentum14: v.optional(v.number()), // % change in linked-ad views over 14 days
    costSource: v.optional(v.string()),   // "aliexpress" = landed cost from the AliExpress Affiliate API (convex/aliexpress.ts)
    costUrl: v.optional(v.string()),      // the matched supplier listing
    costCheckedAt: v.optional(v.string()), // last AliExpress supplier search
    // Top 3 AliExpress suppliers by title match (convex/aliexpress.ts); url is the affiliate link when set up.
    supplierMatches: v.optional(v.array(v.object({
      title: v.string(),
      price: v.number(),
      url: v.string(),
      imageUrl: v.optional(v.string()),
      rating: v.optional(v.number()), // % positive feedback
      orders: v.optional(v.number()), // last 30 days
      similarity: v.number(),
    }))),
    // Distinct advertisers per country among ads seen in the last 7 days
    // (our own data), most crowded first; "level" as lib/productMatch saturationFromCompetition.
    saturationByCountry: v.optional(v.array(v.object({ country: v.string(), advertisers: v.number(), level: v.string() }))),
    // Multi-source fusion (lib/fusion.ts): which source families back this product and how strongly they agree.
    fusion: v.optional(v.object({
      families: v.array(v.string()),
      adLevel: v.boolean(),
      productLevel: v.boolean(),
      confidence: v.number(),
      crossValidated: v.boolean(),
    })),
    verifiedWinner: v.optional(v.boolean()), // a winner that is also cross-validated (winners stage)
    winnerSince: v.optional(v.string()),     // day it first entered the winners list; never cleared
    enrichedAt: v.optional(v.string()),      // winner deep-enrichment queued (fusion.ts, trigger A)
    backfillCheckedAt: v.optional(v.string()), // marketplace product searched for ads (trigger C)
    // Its Amazon twin, matched by image through Nexscope (trigger D); demand backing for ad-only products.
    marketplaceMatch: v.optional(v.object({
      asin: v.string(),
      title: v.string(),
      url: v.string(),
      price: v.optional(v.number()),
      unitsPerMonth: v.optional(v.number()),
      imageUrl: v.optional(v.string()),
    })),
    imageMatchedAt: v.optional(v.string()),
    // 1688 wholesale offers matched by image through Nexscope (trigger E); shown next to AliExpress suppliers.
    wholesaleMatches: v.optional(v.array(v.object({
      title: v.string(),
      priceUsd: v.number(),
      url: v.string(),
      moq: v.optional(v.number()),
      monthlySales: v.optional(v.number()),
      imageUrl: v.optional(v.string()),
    }))),
    wholesaleCheckedAt: v.optional(v.string()),
    storeHost: v.optional(v.string()),  // shop domain of the product page (not marketplaces), for same-store duplicates
    aliases: v.optional(v.array(v.string())), // other names of merged duplicates
  })
    .index("by_url_key", ["urlKey"])
    .index("by_image_hash", ["imageHash"])
    .index("by_store_host", ["storeHost"])
    .index("by_source_units", ["source", "unitsPerMonth"])
    .index("by_hash_band_0", ["hashBand0"])
    .index("by_hash_band_1", ["hashBand1"])
    .index("by_hash_band_2", ["hashBand2"])
    .index("by_hash_band_3", ["hashBand3"])
    .index("by_title_key", ["titleKey"])
    .index("by_margin", ["marginPercent"])
    .index("by_category_score", ["category", "aiScore"])
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
    .index("by_user_and_product", ["userId", "productId"])
    .index("by_product", ["productId"]),

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
    gmv: v.optional(v.number()),              // est. sales from this ad (TikTok Shop), USD
    productId: v.optional(v.id("products")),  // the product this ad sells (convex/productPipeline.ts)
    imageHash: v.optional(v.string()),        // perceptual hash of creativeUrl ("" = couldn't be read), see products.imageHash
    isScaling: v.optional(v.boolean()),       // 14+ days and views growing or engagement above niche median (lib/scaling.ts)
    sources: v.optional(v.array(v.string())), // every source that has delivered this ad
    sourceFields: v.optional(v.object({ live: v.optional(v.object({ source: v.string(), at: v.string() })), advertiser: v.optional(v.object({ source: v.string(), at: v.string() })), engagement: v.optional(v.object({ source: v.string(), at: v.string() })) })), // who wrote each field group
    landingHost: v.optional(v.string()),      // shop domain of the landing page (not marketplaces), ties ads to tracked stores
    // Video transcript (convex/transcripts.ts) and the line spoken in its first 3 seconds.
    transcript: v.optional(v.string()),
    spokenHook: v.optional(v.string()),
    transcriptCheckedAt: v.optional(v.string()),
    audience: v.optional(v.object({
      totalReach: v.optional(v.number()),
      malePct: v.optional(v.number()),
      femalePct: v.optional(v.number()),
      ages: v.array(v.object({ bracket: v.string(), pct: v.number() })),
      countries: v.array(v.object({ code: v.string(), pct: v.number() })),
    })),
  })
    .index("by_first_seen", ["firstSeenAt"])
    .index("by_advertiser", ["advertiserName"])
    .index("by_product", ["productId"])
    .index("by_image_hash", ["imageHash"])
    .index("by_landing_host", ["landingHost"])
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
    .index("by_source_first_seen", ["source", "firstSeenAt"])
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
  // Messages each user sent to the AI assistant per UTC day (daily cap).
  assistantUsage: defineTable({
    userId: v.id("users"),
    day: v.string(), // "YYYY-MM-DD" (UTC)
    count: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  // AI agents (convex/agents.ts, convex/agentRunner.ts): a customer's standing
  // research goal that Claude works on every morning, writing a briefing.
  agents: defineTable({
    userId: v.id("users"),
    name: v.string(),
    goal: v.string(),
    niches: v.array(v.string()),
    enabled: v.boolean(),
    createdAt: v.string(),
    lastRunAt: v.optional(v.string()),
    lastStatus: v.optional(v.string()), // "ok" | "error"
  })
    .index("by_user", ["userId"])
    .index("by_enabled", ["enabled"]),

  agentBriefings: defineTable({
    agentId: v.id("agents"),
    userId: v.id("users"),
    createdAt: v.string(),
    status: v.string(), // "ok" | "error"
    text: v.string(),
  }).index("by_agent", ["agentId"]),

  // Personal access keys for the MCP server (convex/mcp.ts). Only a SHA-256
  // hash of each key is stored; the key itself is shown once at creation.
  mcpKeys: defineTable({
    userId: v.id("users"),
    name: v.string(),
    keyHash: v.string(),
    prefix: v.string(), // first characters of the key, to tell keys apart
    createdAt: v.string(),
    lastUsedAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
  })
    .index("by_hash", ["keyHash"])
    .index("by_user", ["userId"]),

  // MCP tool calls per user per UTC day (daily cap).
  mcpUsage: defineTable({
    userId: v.id("users"),
    day: v.string(), // "YYYY-MM-DD" (UTC)
    count: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  // Winning Products: the top 50 per niche (score 65+), in feed order.
  // Rebuilt once a day by convex/productPipeline.ts.
  winningProducts: defineTable({
    productId: v.id("products"),
    niche: v.string(),
    nicheRank: v.number(),   // 1 = best in its niche
    position: v.number(),    // order in the mixed feed
    score: v.number(),
    enteredDay: v.string(),  // "YYYY-MM-DD" it first entered the list (kept while it stays)
  })
    .index("by_position", ["position"])
    .index("by_niche_rank", ["niche", "nicheRank"])
    .index("by_product", ["productId"]),

  // One row per product and per ad per day (kept 90 days) for the charts.
  dailySnapshots: defineTable({
    day: v.string(), // "YYYY-MM-DD" (UTC)
    kind: v.union(v.literal("product"), v.literal("ad")),
    entityId: v.string(),
    score: v.number(),
    adsRunning: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    spend: v.number(), // est. ad spend so far, USD (upper bound)
    gmv: v.number(),
    trend: v.optional(v.string()),
    saturation: v.optional(v.string()),
  })
    .index("by_entity_day", ["kind", "entityId", "day"])
    .index("by_day", ["day"]),

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
    trigger: v.optional(v.string()),   // "daily" | "winner" | "spike" | "backfill"
    day: v.optional(v.string()),
    capUsd: v.optional(v.number()),    // the most this run may cost (reserved against the daily budget)
    costUsd: v.optional(v.number()),   // what Apify charged, read when the run finished
    productId: v.optional(v.id("products")),
  })
    .index("by_token", ["token"])
    .index("by_day", ["day"]),

  // Sources disagreeing about the same field (lib/fusion.ts). Kept, not
  // silently resolved; admins sample-review them monthly.
  sourceConflicts: defineTable({
    entity: v.string(),   // "ad" | "product"
    entityId: v.string(),
    field: v.string(),    // "live" | "advertiser" | "engagement_vs_age"
    values: v.array(v.object({ source: v.string(), value: v.string() })),
    day: v.string(),
    reviewed: v.optional(v.boolean()),
  })
    .index("by_day", ["day"])
    .index("by_entity_field", ["entityId", "field"]),

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
    source: v.optional(v.string()),     // "product_discovery" = added from a discovered Shopify product
    // Sales tracking (convex/storeSales.ts): last catalog check.
    salesCheck: v.optional(v.object({
      at: v.string(),                   // ISO 8601 UTC
      ok: v.boolean(),
      error: v.optional(v.string()),
      failures: v.number(),             // failed checks in a row; skipped after 3
    })),
    // Polite reading, refreshed weekly: robots.txt verdict for /products.json
    // and the store's currency (from /cart.js).
    polite: v.optional(v.object({ checkedAt: v.string(), robotsAllowed: v.boolean(), currency: v.optional(v.string()) })),
    // Reviews gained per week on its best-selling products (weekly check).
    reviews: v.optional(v.object({ checkedAt: v.string(), perWeek: v.optional(v.number()) })),
    host: v.optional(v.string()),            // "shop.com" (set on catalog checks), for lookups by address
    revenueConfidence: v.optional(v.string()), // "High" | "Medium" for estimatedRevenueRange (lib/revenueModel.ts)
  })
    .index("by_host", ["host"])
    .index("by_niche", ["niche"])
    .index("by_spotted", ["spottedAt"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["niche"] }),

  // Store sales tracking: one row per store per day (kept 90 days).
  storeSalesSnapshots: defineTable({
    storeId: v.id("stores"),
    day: v.string(),                    // "YYYY-MM-DD" (UTC)
    takenAt: v.string(),                // ISO 8601 UTC
    windowHours: v.number(),            // hours since the previous check
    productCount: v.number(),
    updatedCount: v.number(),
    newCount: v.number(),
    avgPrice: v.number(),
    estOrdersLow: v.number(),
    estOrdersHigh: v.number(),
    estRevenueLow: v.number(),
    estRevenueHigh: v.number(),
    topProducts: v.array(v.object({
      title: v.string(),
      url: v.string(),
      imageUrl: v.string(),
      price: v.number(),
      updatedAt: v.string(),
    })),
    currency: v.optional(v.string()),   // the store's own currency (prices above are USD)
    diff: v.optional(v.object({         // catalog changes since the previous check
      added: v.number(),
      removed: v.number(),
      priceChanges: v.number(),
      examples: v.array(v.object({ handle: v.string(), change: v.string(), from: v.optional(v.number()), to: v.optional(v.number()) })),
    })),
  })
    .index("by_store_day", ["storeId", "day"]),

  // Last catalog seen per store (handle, USD price, review count), for daily
  // change lists. Its own table so store lists don't read it.
  storeCatalogs: defineTable({
    storeId: v.id("stores"),
    // f: day we first saw the product (absent for products there at the first check)
    entries: v.array(v.object({ h: v.string(), p: v.number(), r: v.optional(v.number()), f: v.optional(v.string()) })),
  }).index("by_store", ["storeId"]),

  // Product-funnel events for the north-star metric (convex/events.ts): one row
  // per user, type and product per day.
  events: defineTable({
    userId: v.id("users"),
    type: v.string(), // "product_open" | "verdict_view" | "product_save" | "supplier_click"
    productId: v.optional(v.id("products")),
    day: v.string(),
    at: v.number(),
  })
    .index("by_type_day", ["type", "day"])
    .index("by_user_day_type", ["userId", "day", "type"]),

  // Known-truth revenue for calibrating estimates (convex/revenueTruth.ts).
  revenueTruth: defineTable({
    kind: v.string(), // "store" | "product"
    url: v.string(),
    monthlyRevenueUsd: v.number(),
    note: v.optional(v.string()),
    addedAt: v.string(),
  }),

  // Store Tracker: user watchlist
  trackedStores: defineTable({
    userId: v.id("users"),
    storeId: v.id("stores"),
    trackedAt: v.string(), // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_store", ["storeId"])
    .index("by_user_and_store", ["userId", "storeId"]),

  // One-click Shopify import (convex/shopifyImport.ts): the user's own store,
  // via a custom-app Admin API token. The token never leaves the server.
  shopifyConnections: defineTable({
    userId: v.id("users"),
    shopDomain: v.string(),   // "my-store.myshopify.com"
    shopName: v.string(),
    accessToken: v.string(),  // app installs: "enc:v1:…" (AES-GCM, lib/shopifyOAuth.ts); older pasted tokens: plain
    connectedAt: v.string(),  // ISO 8601 UTC
    via: v.optional(v.string()),      // "oauth" (our Shopify app) | missing = pasted custom-app token
    scopes: v.optional(v.string()),
    currency: v.optional(v.string()),
    locale: v.optional(v.string()),   // the store's primary language, e.g. "en", "da"
    // Pages Launch → Full store created here ({ about: "gid://shopify/Page/1", … }), updated on the next store launch.
    storePages: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_user", ["userId"])
    .index("by_shop", ["shopDomain"]),

  // Shopify app install in progress (convex/shopifyApp.ts): ties the OAuth
  // callback back to the signed-in user who started it. Single use, 15 minutes.
  shopifyOAuthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    shop: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // Launch (convex/launch.ts): a product page written by AI and published to
  // the user's Shopify store, with its ad kit.
  launches: defineTable({
    userId: v.id("users"),
    productId: v.union(v.id("products"), v.id("importedProducts")),
    shopDomain: v.string(),
    status: v.string(),               // "generating" | "publishing" | "published" | "failed"
    language: v.string(),
    tone: v.string(),
    publish: v.string(),              // "DRAFT" | "ACTIVE"
    price: v.optional(v.number()),
    copy: v.optional(v.any()),        // the generated page + ad kit (lib/launchCopy.ts LaunchCopy)
    shopifyProductId: v.optional(v.string()),
    adminUrl: v.optional(v.string()),
    storeUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.string(),
    finishedAt: v.optional(v.string()),
    // Full store (mode "store"): the look, the owner's shipping/returns facts, the
    // store copy (lib/storeKit.ts StoreCopy), and the unpublished theme it built.
    mode: v.optional(v.string()),     // "page" (default) | "store"
    style: v.optional(v.string()),    // lib/storeStyles.ts StoreStyleId
    brandName: v.optional(v.string()),
    facts: v.optional(v.any()),       // lib/storeKit.ts StoreFacts
    store: v.optional(v.any()),       // lib/storeKit.ts StoreCopy
    productHandle: v.optional(v.string()),
    pageHandles: v.optional(v.record(v.string(), v.string())), // { about: "about", … } as created
    step: v.optional(v.string()),     // progress while publishing: "product" | "pages" | "theme"
    themeId: v.optional(v.string()),
    themePreviewUrl: v.optional(v.string()),
    themeEditorUrl: v.optional(v.string()),
    themeLive: v.optional(v.boolean()),
    // AI product photos (lib/aiPhotos.ts): how many were asked for, and the ones made (Convex storage).
    aiPhotos: v.optional(v.number()),
    aiPhotoUrls: v.optional(v.array(v.string())),
    aiPhotoIds: v.optional(v.array(v.id("_storage"))),
    aiPhotoNote: v.optional(v.string()),
    // Ad images (launchAds.ts): one picture per ad of the ad kit, same order; the app writes the text on it.
    adImages: v.optional(v.array(v.object({ id: v.id("_storage"), url: v.string(), angle: v.string(), ad: v.number() }))),
    adImagesStatus: v.optional(v.string()), // "making" | "done"
    adImagesNote: v.optional(v.string()),
    adImageRuns: v.optional(v.number()),
    // Supplier reviews (lib/supplierReviews.ts): the AliExpress listing they come from, and what was added.
    reviewsUrl: v.optional(v.string()),
    reviews: v.optional(v.any()),
    reviewsNote: v.optional(v.string()),
    // A relaunch that replaces this earlier launch (its theme and row go once this one is ready).
    replacesLaunchId: v.optional(v.id("launches")),
  })
    .index("by_user", ["userId"])
    .index("by_user_product", ["userId", "productId"]),

  // Launch from any link (productImport.ts): a product page a user pasted, private to them.
  importedProducts: defineTable({
    userId: v.id("users"),
    url: v.string(),
    source: v.string(),               // "aliexpress" | "shopify" | "web"
    title: v.string(),
    description: v.string(),
    category: v.string(),
    imageUrl: v.string(),
    images: v.array(v.string()),
    price: v.optional(v.number()),    // the page's selling price, USD
    cost: v.optional(v.number()),     // the supplier's price, USD (AliExpress)
    createdAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_url", ["userId", "url"]),

  // Published launches per user per month (the plan quota).
  launchUsage: defineTable({ userId: v.id("users"), month: v.string(), count: v.number() })
    .index("by_user_month", ["userId", "month"]),

  // Hooks of the week (convex/hooks.ts): top ad opening lines per niche.
  weeklyHooks: defineTable({
    week: v.string(),        // ISO week, "2026-W40"
    niche: v.string(),
    rank: v.number(),        // 1 = best
    adId: v.id("ads"),
    hook: v.string(),
    type: v.optional(v.string()),     // HOOK_TYPES, from Claude
    why: v.optional(v.string()),      // why it works
    template: v.optional(v.string()), // reusable fill-in-the-blank version
    score: v.number(),                // engagement used for ranking
    createdAt: v.string(),
  })
    .index("by_week", ["week"])
    .index("by_week_niche", ["week", "niche", "rank"]),

  // Short-lived video download links (convex/videoDownload.ts).
  downloadTokens: defineTable({
    token: v.string(),
    adId: v.id("ads"),
    userId: v.id("users"),
    expiresAt: v.number(),    // ms
    sourceUrl: v.optional(v.string()), // resolved file link (TikTok), else ads.videoUrl
    cookie: v.optional(v.string()),    // cookies TikTok requires with that link
  })
    .index("by_token", ["token"])
    .index("by_expires", ["expiresAt"]),

  // Follow alerts: advertisers a user follows (convex/follows.ts).
  // All free accounts' AI requests per day (convex/assistantUsage.ts claimMessage).
  aiFreeUsage: defineTable({
    day: v.string(), // YYYY-MM-DD (UTC)
    count: v.number(),
  }).index("by_day", ["day"]),

  // One row per daily import run (convex/importRuns.ts); pruned after 60 days.
  importRuns: defineTable({
    job: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    status: v.string(), // "ok" | "partial" | "failed" | "skipped"
    summary: v.string(),
    errors: v.array(v.string()), // at most 10
  }).index("by_job_started", ["job", "startedAt"]),

  // Pro alerts on products (convex/follows.ts): new ads for it, or its score
  // reaching minScore. last* are the values at the previous daily check.
  followedProducts: defineTable({
    userId: v.id("users"),
    productId: v.id("products"),
    minScore: v.optional(v.number()),
    lastScore: v.optional(v.number()),
    lastLinkedAds: v.optional(v.number()),
    followedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_product", ["productId"])
    .index("by_user_and_product", ["userId", "productId"]),

  followedAdvertisers: defineTable({
    userId: v.id("users"),
    name: v.string(),        // exact ads.advertiserName
    followedAt: v.string(),  // ISO 8601 UTC
  })
    .index("by_user", ["userId"])
    .index("by_name", ["name"])
    .index("by_user_and_name", ["userId", "name"]),

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
    notifyFollowedAdvertisers: v.optional(v.boolean()), // missing = on
    emailDigestEnabled: v.boolean(),
    updatedAt: v.string(), // ISO 8601 UTC
    unsubscribeToken: v.optional(v.string()), // in every digest's unsubscribe link (convex/digest.ts)
    lastDigestDay: v.optional(v.string()),    // the user's local date of the last digest sent
  })
    .index("by_user", ["userId"])
    .index("by_unsubscribe_token", ["unsubscribeToken"])
    .index("by_digest", ["emailDigestEnabled"]),

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
    .index("by_ad_key", ["adKey"])
    .index("by_visitor_status", ["submitterVisitorId", "status"])
    .index("by_status_submitted", ["status", "submittedAt"]),

  // AdSpy Pro backend (Render) session token per user, saved at sign-in so the
  // server can call the backend's isUser routes (payments). Never sent to the
  // browser. convex/adspyAuth.ts writes it; convex/proPlan.ts reads it.
  backendSessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    updatedAt: v.number(),
    planCheckedAt: v.optional(v.number()), // last /user/checkSubscription (refreshMyPlan)
  }).index("by_user", ["userId"]),

  // Pro auto-renewal (convex/proPlan.ts): the saved card and when the paid
  // period ends. Renewal charges the card when the backend reports the
  // subscription ended (not more than 2 days before periodEnd).
  proBilling: defineTable({
    userId: v.id("users"),
    customerId: v.optional(v.string()),       // Stripe customer
    paymentMethodId: v.optional(v.string()),  // saved card, set after the first payment
    period: v.union(v.literal("monthly"), v.literal("yearly")),
    periodEnd: v.optional(v.number()),        // ms
    autoRenew: v.boolean(),
    renewedFor: v.optional(v.number()),       // periodEnd a renewal was attempted for (once each)
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Stripe PaymentIntents that already activated Pro, so one payment can't be
  // used twice (convex/proPlan.ts).
  proPayments: defineTable({
    paymentIntentId: v.string(),
    userId: v.id("users"),
    amount: v.number(),
    currency: v.string(),
    at: v.number(),
  }).index("by_payment_intent", ["paymentIntentId"]),
});
