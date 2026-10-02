import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily "winning products" email digest — sent to users who opted in via alert
// preferences. Runs once per day; consumes a small, bounded amount of Hercules
// Cloud action compute and email volume per run (never scales with table size).
crons.daily(
  "send winning products email digest",
  { hourUTC: 13, minuteUTC: 20 },
  internal.emailSender.sendDailyDigest
);

// Daily AdLibrary.com sync — pulls real running ads for each curated niche
// (6 requests/day, well under AdLibrary's 10,000/day limit) and upserts them
// into Ad Spy. Consumes AdLibrary API credits automatically every run.
crons.daily(
  "sync ads from AdLibrary.com",
  { hourUTC: 6, minuteUTC: 15 },
  internal.adlibrary.sync.runSync,
  {}
);

// Daily Nexscope.ai pricing backfill — runs 15 minutes after the AdLibrary
// sync so newly-synced Winning Products exist to price. Fills price/cost
// with an honest category market-price estimate (never AdLibrary's exact
// product, since AdLibrary provides none). Skipped entirely if products are
// already priced. Consumes Nexscope API credits automatically every run.
crons.daily(
  "backfill product pricing from Nexscope.ai",
  { hourUTC: 6, minuteUTC: 30 },
  internal.nexscope.pricing.backfillProductPricing
);

// Daily Nexscope.ai product discovery — pulls real Amazon bestseller
// candidates (2 per niche, 12 requests/day total across both Nexscope jobs)
// and upserts them as additional real Winning Products, each with its own
// real title/image/price (not a benchmark). Consumes Nexscope API credits
// automatically every run.
crons.daily(
  "discover winning products from Nexscope.ai",
  { hourUTC: 6, minuteUTC: 45 },
  internal.nexscope.productDiscovery.discoverProducts
);

// Optional daily TikTok ads from Nexscope — only runs when the
// NEXSCOPE_TIKTOK_COUNTRIES env var is set (e.g. "gb,de").
crons.daily(
  "import TikTok ads from Nexscope.ai",
  { hourUTC: 7, minuteUTC: 5 },
  internal.nexscope.tiktokAds.dailyTikTokImport
);

// Optional daily Meta Ad Library runs on Apify — only runs when the
// APIFY_COUNTRIES env var is set (e.g. "DK,SE"). Results arrive via webhook.
crons.daily(
  "start Meta Ad Library imports on Apify",
  { hourUTC: 7, minuteUTC: 25 },
  internal.apify.dailyApifyImport
);

// WinningHunter REST import — only runs when WINNINGHUNTER_API_KEY is set.
// Markets: WH_COUNTRIES (default DK,SE,NO,DE,GB,US), WH_PAGES × 50 ads each.
crons.daily(
  "import winning Meta ads from WinningHunter",
  { hourUTC: 7, minuteUTC: 45 },
  internal.winninghunter.dailyImport
);

// Products pipeline, after all imports: link ads to products, rebuild
// Winning Products (top 50 per niche), then save today's history snapshot
// for the charts. Runs as a chain of small steps (convex/productPipeline.ts).
crons.daily("link ads to products, rebuild winners, save history", { hourUTC: 8, minuteUTC: 5 }, internal.productPipeline.start);

// Rebuild filter counts / admin totals once a day as a backstop.
crons.daily("rebuild site stats", { hourUTC: 9, minuteUTC: 5 }, internal.stats.recompute);

// AI agents: each enabled agent writes its morning briefing, after the
// products pipeline and Research rebuild (convex/agentRunner.ts).
crons.daily("run AI agents", { hourUTC: 9, minuteUTC: 20 }, internal.agentRunner.runAll);

// Follow alerts: one alert per followed advertiser that launched new ads
// since the last run, after the imports and the products pipeline.
crons.daily("send follow alerts", { hourUTC: 8, minuteUTC: 35 }, internal.follows.sendDailyAlerts, {});

// Store sales tracking: read tracked and discovered Shopify stores' public
// catalogs and save today's estimate (convex/storeSales.ts).
crons.daily("track Shopify store sales", { hourUTC: 10, minuteUTC: 5 }, internal.storeSales.runAll, {});

export default crons;
