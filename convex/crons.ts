import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Store sales checks, image hashing and landing-page prices are steps of the
// daily pipeline below (convex/productPipeline.ts), so they run in order after
// the imports instead of at separate times.

// Morning digest: hourly, everyone whose local time is 8:00 gets theirs once
// (convex/emailSender.ts). The pipeline also sends right after it finishes.
crons.hourly("send morning digests at each user's 8:00", { minuteUTC: 10 }, internal.emailSender.sendMorningDigests, {});

// Each import below runs through importRuns.run, which records the result
// (counts, errors, skipped) so failures show up in Admin → Data sources.

// Daily AdLibrary.com sync — pulls real running ads for each curated niche
// (6 requests/day, well under AdLibrary's 10,000/day limit) and upserts them
// into Ad Spy. Consumes AdLibrary API credits automatically every run.
crons.daily(
  "sync ads from AdLibrary.com",
  { hourUTC: 6, minuteUTC: 15 },
  internal.importRuns.run,
  { job: "adlibrary" }
);

// Daily Nexscope.ai pricing backfill — runs 15 minutes after the AdLibrary
// sync so newly-synced Winning Products exist to price. Fills price/cost
// with an honest category market-price estimate (never AdLibrary's exact
// product, since AdLibrary provides none). Skipped entirely if products are
// already priced. Consumes Nexscope API credits automatically every run.
crons.daily(
  "backfill product pricing from Nexscope.ai",
  { hourUTC: 6, minuteUTC: 30 },
  internal.importRuns.run,
  { job: "nexscopePricing" }
);

// Daily Nexscope.ai product discovery — pulls real Amazon bestseller
// candidates (2 per niche, 12 requests/day total across both Nexscope jobs)
// and upserts them as additional real Winning Products, each with its own
// real title/image/price (not a benchmark). Consumes Nexscope API credits
// automatically every run.
crons.daily(
  "discover winning products from Nexscope.ai",
  { hourUTC: 6, minuteUTC: 45 },
  internal.importRuns.run,
  { job: "nexscopeDiscovery" }
);

// Optional daily TikTok ads from Nexscope — only runs when the
// NEXSCOPE_TIKTOK_COUNTRIES env var is set (e.g. "gb,de").
crons.daily(
  "import TikTok ads from Nexscope.ai",
  { hourUTC: 7, minuteUTC: 5 },
  internal.importRuns.run,
  { job: "nexscopeTikTok" }
);

// The daily Apify run (it scrapes facebook.com/ads/library) is turned off:
// we only use official APIs and licensed data sources for Meta ads.

// WinningHunter REST import — only runs when WINNINGHUNTER_API_KEY is set.
// Markets: WH_COUNTRIES (default DK,SE,NO,DE,GB,US), WH_PAGES × 50 ads each.
crons.daily(
  "import winning Meta ads from WinningHunter",
  { hourUTC: 7, minuteUTC: 45 },
  internal.importRuns.run,
  { job: "winninghunter" }
);

// PiPiSpy — only runs when PIPISPY_API_KEY and PIPISPY_COUNTRIES are set.
// Runs before the products pipeline below. Each ad costs 1 credit: PIPISPY_DAILY_PER_COUNTRY × countries per day.
crons.daily("import ads from PiPiSpy", { hourUTC: 7, minuteUTC: 35 }, internal.importRuns.run, { job: "pipispy" });

// Meta's official Ad Library API (EU commercial ads) — only runs when
// META_ACCESS_TOKEN is set (convex/metaAdLibrary.ts).
crons.daily("import ads from the Meta Ad Library API", { hourUTC: 7, minuteUTC: 20 }, internal.importRuns.run, { job: "metaAdLibrary" });
// Products pipeline, after all imports: link ads to products, rebuild
// Winning Products (top 50 per niche), then save today's history snapshot
// for the charts. Runs as a chain of small steps (convex/productPipeline.ts).
// Pro (AdSpy Pro backend) ends when its month or year is over: convex/proPlan.ts.
// Also re-checked whenever the user opens the dashboard (refreshMyPlan).
crons.hourly("refresh Pro plans from the AdSpy Pro backend", { minuteUTC: 50 }, internal.proPlan.refreshPlans, {});
// Daily pipeline: images → link → landing pages → dedupe → stores → score →
// winner gates → history → lists → morning emails (convex/productPipeline.ts).
crons.daily("daily pipeline: link, dedupe, score, winners, lists, emails", { hourUTC: 8, minuteUTC: 5 }, internal.productPipeline.start);

// Rebuild filter counts / admin totals once a day as a backstop.
crons.daily("rebuild site stats", { hourUTC: 9, minuteUTC: 5 }, internal.stats.recompute);

// AI agents: each enabled agent writes its morning briefing, after the
// products pipeline and Research rebuild (convex/agentRunner.ts).
crons.daily("run AI agents", { hourUTC: 9, minuteUTC: 20 }, internal.agentRunner.runAll);

// Follow alerts are the daily pipeline's "alerts" step (convex/follows.ts).

// Exchange rates for display currencies, after the ECB publishes (~16:00 CET).
crons.daily("refresh exchange rates", { hourUTC: 16, minuteUTC: 30 }, internal.currency.refreshRates, {});

// Revenue estimates checked against the known-truth set (Admin → Revenue
// calibration) on the 1st of each month (convex/revenueTruth.ts).
crons.monthly("calibrate revenue estimates", { day: 1, hourUTC: 5, minuteUTC: 17 }, internal.revenueTruth.calibrateMonthly, {});

// Supplier cost from the AliExpress Affiliate API before the products
// pipeline computes margins — only runs when ALIEXPRESS_APP_KEY/SECRET are set.
crons.daily("look up supplier costs on AliExpress", { hourUTC: 7, minuteUTC: 55 }, internal.importRuns.run, { job: "aliexpressCosts" });

// Video ad transcripts → spoken hooks — only runs when DEEPGRAM_API_KEY is set
// (convex/transcripts.ts).
crons.daily("transcribe video ads", { hourUTC: 10, minuteUTC: 40 }, internal.importRuns.run, { job: "transcripts" });

// Hooks of the week: Mondays after the morning imports (convex/hooksBuilder.ts).
crons.weekly("build hooks of the week", { dayOfWeek: "monday", hourUTC: 9, minuteUTC: 40 }, internal.hooksBuilder.buildWeekly, {});

export default crons;
