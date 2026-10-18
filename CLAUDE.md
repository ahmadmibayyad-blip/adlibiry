# AdSpy Pro

Ad and product research app: React + Vite frontend (`src/`), Convex backend (`convex/`), deployed on Vercel.
Vercel runs `convex deploy` on every push to `main`, so merging a PR ships both frontend and backend.

## Commands

- `pnpm test` runs all tests (vitest: `convex/**/*.test.ts` in edge-runtime, `src/**/*.test.tsx` in jsdom)
- `npx tsc --noEmit -p convex` typechecks the backend (`pnpm build` only checks the frontend)
- `pnpm build` typechecks the frontend and builds
- `npx eslint <files>` lints. The whole repo isn't lint-clean yet, so CI lints only the files a PR changes. Keep files you touch clean.
- Don't run Prettier over whole files: most of the repo isn't formatted with it, and the diffs get noisy.

## Convex

- New modules must appear in `convex/_generated/api.d.ts`. `npx convex dev` regenerates it; without a deployment, add the
  `import type * as x from "../x.js"` line and the `"x": typeof x` entry by hand, in alphabetical order.
- Backend tests live in the `convex/` root (`convex/foo.test.ts`), use `convexTest(schema, import.meta.glob("./**/*.ts"))`,
  and sign in with `t.withIdentity({ subject: "<token>|s" })` after inserting a `users` row with `tokenIdentifier: "<token>"`.
  Stub network calls with `vi.stubGlobal("fetch", ...)`.
- Admin-only functions call `requireAdmin(ctx)` from `convex/admin/helpers.ts`. Users are looked up by
  `stableToken(identity)` on the `by_token` index.
- Call `markStatsDirty(ctx)` (`convex/stats.ts`) after adding or removing ads or products in bulk.
- Read with `.withIndex(...)`, not `.filter(...)`; paginate or `.take(n)`. Files using Node APIs start with `"use node"`.
- Pure logic goes in `convex/lib/*.ts` and is unit tested there; the Convex function files call it.
- Crons are in `convex/crons.ts`. Daily imports run through `internal.importRuns.run` ({ job }), which records each run (counts, errors,
  "not set up") for Admin → Daily imports; a new import job returns `{ ..., errors: string[] }` or `{ notConfigured: "…" }`
  and catches per-country/niche failures instead of throwing.

## Accounts

- Email sign-in and sign-up go through the AdSpy Pro backend on Render (`ADSPY_BACKEND_URL`, default
  https://adspypro.onrender.com): `convex/adspyAuth.ts` + `convex/lib/adspyBackend.ts`, Convex Auth provider `"adspypro"`.
  Each backend user id is linked to one app user; never link by email alone (anyone can register any email there).
- "Continue with Google" also gets a backend account (`syncGoogleAccount`): new emails are registered with a random
  password and linked; emails already on the backend are not linked (unverified owner), only their token is kept.
  The token comes from `POST /user/login?loginFrom=google`; `ADSPY_BACKEND_SERVER_KEY` adds an `x-server-key` header.
- The plan comes from the backend's `/user/checkSubscription` on every sign-in. Its `isUser` middleware reads
  `authorization: <AUTH_SECRET_KEY><token>`; the key is the Convex env var `ADSPY_BACKEND_AUTH_KEY` (never commit it).

## Plans and payments

- Free (first 10 results of each list) and Pro: €35 monthly or €360 yearly (€30/month), one payment per period,
  renewed automatically (saved card, `proBilling`) unless turned off in Settings. Backend `/subscription/pay` multiplies the amount by 12 for yearly, so we send 3000 for yearly.
- Flow (`convex/proPlan.ts`): backend `POST /subscription/pay` creates the PaymentIntent (amount set on the server) →
  the browser pays with Stripe Elements (`src/components/billing/ProCheckoutDialog.tsx`) → `confirmProPayment` checks the
  PaymentIntent with Stripe (`STRIPE_SECRET_KEY`, same Stripe account as the backend), uses it once (`proPayments`), then
  calls `POST /subscription/start`. `/user/checkSubscription` is re-read hourly (cron) and when the dashboard opens
  (`refreshMyPlan`, every 2 min at most); its HTTP status decides (200 = Pro, 404 = Free). On a 404 with auto-renew on,
  the saved card is charged off-session (once per period, idempotency key) and `/subscription/start` renews it.
- The backend token from sign-in is kept server-side in `backendSessions`; never send it to the browser.

## Environment and secrets

- Convex env vars are set per deployment: Convex dashboard → **Production** deployment → Settings → Environment Variables.
  Project "Default Environment Variables" don't reach the existing production deployment.
- Never ask for API keys, client secrets or tokens in chat. Tell the user where to set them.
- Claude API calls go through `claudeClient()` in `convex/lib/claudeClient.ts` (it adds the workspace header).
- With `KIMI_API_KEY` set (optional `KIMI_MODEL`, default `kimi-k2.6`), a Claude call that fails for billing, overload, rate limits
  or an outage is answered by Kimi instead (`convex/lib/kimiFallback.ts`). Calls with tools or streaming stay on Claude.

## Billing (Stripe)

- Checkout, the billing portal and the webhook are in `convex/commerce.ts`; plan rules in `convex/lib/billing.ts`;
  the user's plan is stored by `convex/billing.ts` and read with `billing.myPlan` (`useUserPlan()` in the app).
- Convex env vars (Production deployment): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and one price ID per plan:
  `STRIPE_PRICE_{STARTER,PRO,AGENCY}_{MONTHLY,YEARLY}`. A plan whose price isn't set shows "isn't available yet".
- Stripe webhook endpoint: `https://<deployment>.convex.site/stripe/webhook`, events
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Trials are 7 days without a card (`payment_method_collection: "if_required"`); no card by day 7 cancels.
- Access: trialing, active and past_due keep the plan; admins always get Agency.
- Result limit: free and trialing accounts see the first 10 results of each list (`resultLimit` in `convex/lib/billing.ts`,
  applied by `limitedPage` / `resultLimitFor` in `convex/lib/access.ts`); active and past_due subscribers and admins see all.

## Data

- Ads come from source syncs (`convex/sources`, `convex/adlibrary`, `convex/nexscope`) and admin CSV imports (`source: "csv_import"`).
  All rows of one CSV import share its `firstSeenAt`; Admin → Ads can remove the last import.
- Scraped CSVs often miss columns (likes, impressions, prices). Check which columns are filled before importing.
- Ad spend estimate (`convex/lib/euSpend.ts`, app side `src/lib/euSpend.ts`): an ad with EU reach (`audience.totalReach`, Meta's DSA data)
  shows spend = reach ÷ 1,000 × CPM, like Minea ($9) and WinningHunter ($11); others keep their source's `spendEstimate`. The CPM is the user's
  (Ad Spy → CPM box, localStorage `adspy-cpm`, default 9) and goes to `ads.list` as `cpm` for the spend filter. "Highest est. spend" sorts by
  the `by_eu_reach` index. `ads.advertiserReach` totals an advertiser's EU reach over the ads we have (ad page line).
- Video transcripts (`transcripts.ts`, Deepgram, `DEEPGRAM_API_KEY`) show on the ad page ("What's said", `AdTranscript.tsx`) with the spoken hook;
  Translate (`transcriptsAi.translate`, languages in `lib/transcriptLanguages.ts`) keeps each language on the ad (`transcriptTranslations`), so a
  language is translated once for everyone; a new one counts against the AI daily limit.
- Store tech (`storeTech.ts`, `lib/storeTech.ts`): the daily "storeTech" job reads up to 60 listed stores' home pages (plain fetch, no browser)
  and saves theme, apps and pixels on `stores.tech` (again after 30 days; a failed read keeps the last good one). A Store Inspector run copies
  its result onto the store with the same `host`. Stores page filters Theme / Uses app / Pixel (`stores.list` theme/app/pixel, options from
  `stores.techOptions`); stores not read yet don't match them.
- Offer Search (`convex/offerSearch.ts`, `/dashboard/offer-search`) searches Meta's Ad Library for an offer in the country's
  language through Apify (trigger "offer", counted against `APIFY_DAILY_BUDGET_USD`); its ads also land in Ad Spy.
  Same search within 6h is answered from the last one. Phrases per language: `convex/lib/offerSearch.ts`.
  The daily Meta API import (`metaAdLibrary.ts`) also searches each offer's phrase per country (`META_OFFER_SEARCH=off` stops it);
  Ad Spy's Offer filter reads the ad text with `convex/lib/offerTags.ts`.
- Launch → "Mirror a page" (Full store, `mirrorUrl`; UI names: Mirror, Inspect, Watchlist, AdSpy score): launchRun reads that product page with Store Teardown (`lib/pageFetch.ts`),
  `lib/pageMirror.ts` turns it into a plan (section order, bundle deals as items + % off, buy-box extras) saved as `launches.mirror`;
  both themes' product templates follow it and the bundle discounts use its quantities (`bundleQty`). Structure only, never text or photos.
  A home page link (or the product page's store) also copies the home page: `lib/siteMirror.ts` maps its sections to ours (`mirror.home`, incl. the
  `timeline` and `marquee` sections) and reads its colors and Google fonts (`mirror.look` → theme settings `custom_head_font`/`custom_body_font`); our theme only, not Dawn.
- Launch → "Special requests" (`launches.wishes`): added to every AI brief in launchRun; for a Full store (Dawn: colors and corners only) a small request reads
  look changes from it (`lib/designWishes.ts`, saved as `launches.design`), applied over the style and a mirrored look.
- Launch → "Match a screenshot" (Full store): `screenshotLook.read` reads a screenshot's colors, fonts and shapes before launch; `launch.start`
  saves it as `launches.look`, and launchRun merges the special requests' look over it (`mergeDesign`) into `launches.design`. Dawn takes colors and corners, not fonts.
- Screenshot to page (`/dashboard/page-builder`, `screenPages.ts` + `screenPagesAi.ts`, prompts in `lib/screenPage.ts`): a screenshot (cut into up to 6
  parts by `src/lib/screenshotParts.ts`, kept in storage) becomes one Tailwind HTML file; changes in plain words, one-step undo. Optional products (up to 6, read by `productImport.importLink` into importedProducts, `screenPages.productIds`) replace the screenshot's: names, `shownPrice` (store currency), photos and links go into the brief (`productsBrief`). Daily limit per tier
  (`SCREEN_PAGE_RUNS`, counted in `screenPageRuns`) plus the shared AI limit. The preview iframe is `sandbox="allow-scripts"` only: never give AI HTML the app origin.
- Both take a link too: `pageShots.take` runs Apify's free `apify/screenshot-url` (full page, 1280 wide, ~20 s, ~$0.003) and returns the PNG to the browser,
  which cuts it like an upload. Daily limit `LINK_SHOTS` (table `pageShots`); needs `APIFY_TOKEN`. A sticky header can show up mid-image (scroll artefact).
- Publish to Shopify (`screenPagesShopify.publish`, pure parts in `lib/landingShopify.ts`): a Shopify page (templateSuffix `adspy-landing`) with
  the HTML as its body. Three theme files (`LANDING_FILES`, generated from `shopify-theme/` by build-theme.mjs and in both theme folders) go into
  the live theme with `themeFilesUpsert`: layout `adspy-landing` (the page as a whole document, `content_for_header` put into its head for
  analytics and pixels), the page template, and section `adspy-landing-home`. `asHome` writes `templates/index.json` pointing at the page, after
  saving the theme's own in `homeBackups` (never a landing one); `restoreHome` writes it back. Links that go nowhere (`#`) are pointed at the
  store's menu, collections, pages and products by a small AI request, only to paths the store has. If Shopify refuses the files, the error
  (code TEMPLATE_NEEDED) carries them for the user to add by hand, and no page is made. Publishing again updates the same page.

- Page fetching (`lib/pageFetch.ts` fetchPage, used by Store Inspector, Mirror a page and Import from link): a plain fetch first; a bot check, an
  empty script-built page or a 403/429/timeout goes to our own browser, `api/render.ts` (headless Chrome on Vercel: puppeteer-core +
  @sparticuz/chromium, kept in step; vercel.json includeFiles names its real .pnpm folder with the version, since Vercel rejects symlinked paths; POST {url, markdown?}, `Authorization: Bearer RENDER_SECRET`, refuses private addresses). Needs
  `RENDER_SECRET` set to the same value in Vercel and Convex (optional `RENDER_URL`). Datacenter IPs: sites that block servers (AliExpress) stay on Apify.

- Store Inspector → Store age: the Wayback Machine CDX API (free, no key, slow: 8–30 s, asked alongside the pages, 35 s timeout) gives the
  first/last saved copy and one per year (`lib/storeHistory.ts`, `Inspection.history`; null = archive didn't answer, cached like the rest).
- Selling calendar (dashboard home, `SellingCalendar.tsx`): gift and deal days per country computed in `lib/sellingCalendar.ts` (Mother's/Father's
  Day rules differ per country; `readyBy` = when ads should run) plus public holidays from Nager.Date cached in `publicHolidays` (`sellingCalendar.load`,
  30-day refresh). The app merges them (`upcoming`) because a query doesn't re-run when the date changes.
  Countries: every Nager.Date country plus AE/SA (`lib/calendarCountries.ts`, a snapshot of its AvailableCountries); flags and names come from
  the browser (`flagOf`, `anyCountryName` in `src/lib/countries.ts`). REST Countries v3 is retired and v5 needs a key, so it isn't used.
- Exchange rates (`currency.ts refreshRates`, daily): the ECB's XML, else the same ECB rates from Frankfurter (api.frankfurter.dev/v1, no key);
  `withPegged` adds the dollar-pegged Gulf currencies (AED, SAR, QAR, BHD, OMR, JOD) the ECB doesn't publish. `toUsd(p, usdRates)` uses today's
  rates when an action passes them (`internal.currency.allRates`); the table in `lib/priceParse.ts` is only the fallback.

- Store Inspector → Google & YouTube ads (`googleAds.forStore`, `lib/googleAds.ts`): Google's Ads Transparency Center through ScrapeCreators
  (`SCRAPECREATORS_API_KEY`, header x-api-key; Google has no official API). `/v1/google/company/ads?domain=…&get_ad_details=true` costs 25 credits
  (~$0.05); answers kept 24 h per store and platform (`googleAdLookups`), per-user daily limit `GOOGLE_AD_LOOKUPS` (`googleAdRuns`).
- CJ Dropshipping (`cj.ts`, `lib/cj.ts`, `CJ_API_KEY`; optional `CJ_LOOKUPS_PER_DAY`, default 500): a second supplier. A product page without
  `cjMatches` searches CJ's /product/listV2 by title once (retry after 7 days), matched like AliExpress. `cj.shipping` prices the best match
  to the user's target country (/product/query → vid, /logistic/freightCalculate), from a CJ warehouse in that country when it has stock,
  cached a week (`cjShipping`). CJ allows 1 request/second; the 180-day access token is kept in `cjAuth` and renewed with its refresh token.

- Store Inspector → domain registered (`domainInfo.registered`, Node: whois over TCP port 43): RDAP from IANA's bootstrap (rdap.org as backup;
  it blocks clients without a User-Agent) for .com etc.; whois for country domains without RDAP (`WHOIS_SERVERS`: .se, .dk, .no, …). .de
  publishes no dates. `DOMAIN_LOOKUPS=off` turns it off; tests set it because fetch stubs can't catch TCP.
- Store Inspector → Speed (`storeSpeed.check`, `PAGESPEED_API_KEY`, required: no key = 429): phone + desktop, 24 h cache per store (`storeSpeeds`).
- Product page → On YouTube (`youtube.productVideosFor`, `YOUTUBE_API_KEY`): a search is 100 of the 10,000 daily quota units, so
  `YOUTUBE_SEARCHES_PER_DAY` (default 90); saved on the product (`youtube`), refreshed after 14 days. The same Google key can serve PageSpeed.
- Screenshot to page → photos: placehold.co placeholders with a text get a Pexels photo (`lib/pexels.ts`, `PEXELS_API_KEY`, 200 searches/hour),
  cropped via Pexels' CDN params; credits saved in `screenPages.photoCredits` and shown with a link to Pexels (their API terms).

## Your store (Profit, Orders, Ad queue)

- Scopes: `read_orders,read_inventory,read_merchant_managed_fulfillment_orders` (SHOPIFY_SCOPES must equal `shopify-app/shopify.app.toml`,
  a test checks; deploy the app config with Shopify CLI). Older installs reconnect. No customer fields are read. Never ask for write_orders/customers.
- Profit (`profit.ts`, `lib/profit.ts`, `/dashboard/profit`): orders' financial fields only (no customer fields), per store day in the shop's
  time zone (`profitDays`); product cost = Shopify unitCost → AdSpy launch cost → CJ's real bill. Hourly cron recounts 2 days; ad spend is typed in
  per day and survives recounts. Yesterday's line goes into the morning digest (`renderProfitHtml`), which now also sends on profit-only days.
- Orders (`orders.ts`, `lib/orderTracker.ts`, `/dashboard/orders`): works with whatever fulfills the store (the owner's fulfillment app such as
  CJ, DSers, AutoDS or Zendrop, an agent, or by hand); AdSpy places no orders. `orders.load` reads the last 30 days live from Shopify (status,
  tracking, the app or location each order is assigned to; no customer fields, nothing stored) and flags late (paid, not shipped after
  `LATE_DAYS`), no tracking, slow (`SLOW_DAYS` on the way) and delivery problems. The old CJ autopilot's tables (cjOrders, cjLinks,
  orderSettings) are no longer written.
- Ad queue (`adQueue.ts`, `adQueueAi.ts`, `/dashboard/ad-queue`): published launches' ad kits become `adDrafts` (pending) when the page opens;
  approve / edit / reject; "Make variations" adds 3 AI drafts (AI daily limit). Nothing is posted anywhere.

## UI

- Components: shadcn/ui in `src/components/ui`, icons from `lucide-react`, toasts via `sonner`, charts via `src/pages/dashboard/_components/charts.tsx`.
- Filters use dropdowns (`src/components/FilterSelect.tsx`), not chip rows. The Products page starts in grid view.
