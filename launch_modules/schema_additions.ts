// DESIGN REFERENCE (Launch feature) — schema additions, merged into convex/schema.ts.
// Integrated tables:
//   shopifyConnections  — EXISTING table, extended (accessToken comment, via/scopes/currency/locale, by_shop index)
//   shopifyOAuthStates  — NEW (the brief's "shopifyAuthPending": single-use OAuth states, 15 min TTL)
//   launches            — NEW (the brief's "generatedPages": one row per generated/published page)
//   launchUsage         — NEW (the brief's "launches": per-user per-month published-page quota)
// Edit convex/schema.ts, not this file.

// ── existing table, extended ─────────────────────────────────────────────────
// shopifyConnections: one connected store per account. accessToken is
// "enc:v1:…" (AES-GCM, key in the SHOPIFY_TOKEN_KEY env secret) for app
// installs; older pasted custom-app tokens are still plain and work until the
// merchant reconnects through the AdSpy Pro app.
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
})
  .index("by_user", ["userId"])
  .index("by_shop", ["shopDomain"]),

// ── new ──────────────────────────────────────────────────────────────────────
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
  productId: v.id("products"),
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
})
  .index("by_user", ["userId"])
  .index("by_user_product", ["userId", "productId"]),

// Published launches per user per month (the plan quota).
launchUsage: defineTable({ userId: v.id("users"), month: v.string(), count: v.number() })
  .index("by_user_month", ["userId", "month"]),
