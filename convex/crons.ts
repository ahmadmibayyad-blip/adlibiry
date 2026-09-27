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
  internal.adlibrary.sync.runSync
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

export default crons;
