# AdSpy Pro

Ad and product research app: React + Vite frontend (`src/`), Convex backend (`convex/`), deployed on Vercel.
Developer notes are in [CLAUDE.md](CLAUDE.md).

## Settings you provide

Set these in the Convex dashboard → **Production** deployment → Settings → Environment Variables
(never in the code). Features whose settings are missing stay switched off and show as "not set up" in
Admin → Data sources.

| Variable | What it turns on |
|---|---|
| `SITE_URL` | The app's public address, used in emails and payment return links. Set it to `https://adspypro.net`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sending email (morning digest). Verify `adspypro.net` in Resend first; `EMAIL_FROM` defaults to `AdSpy Pro <alerts@adspypro.net>`. |
| `META_ACCESS_TOKEN` | Daily import from Meta's official Ad Library API. It only has commercial ads for EU countries and the UK, so `META_AD_COUNTRIES` (default `DK,SE,DE,NL,FR`) skips any other country with a note. Long-lived tokens expire after about 60 days; Admin → Daily imports then says "Meta token expired". Needs identity confirmation (facebook.com/ID) and the Ad Library API terms. Optional: `META_GRAPH_VERSION` (default `v23.0`). |
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` | Supplier sourcing from the AliExpress Affiliate API: the top 3 suppliers per product (product page → Suppliers) and the landed cost for margins. `ALIEXPRESS_TRACKING_ID` makes supplier links affiliate links (commission on orders); `ALIEXPRESS_SHIPPING_USD` is the shipping estimate added to the price (default 3). |
| `DEEPGRAM_API_KEY` | Video ad transcripts: the line spoken in the first 3 seconds becomes the ad's hook in Hooks of the week (about 40 videos a day, scaling ads first). |
| `APIFY_TOKEN`, `APIFY_COUNTRIES` | Daily Meta Ad Library ads through Apify (actor `curious_coder/facebook-ads-library-scraper`): 6 niches × 50 ads per country, about $0.23 per country per day. `APIFY_COUNTRIES` e.g. `DK,SE`; each run is capped at about $0.07 (`APIFY_MAX_RUN_USD` overrides). Meta's terms don't allow scraping its Ad Library, so this is your call. |
| `ADLIBRARY_PAUSED` | `true` stops AdLibrary's daily bulk sync (e.g. while it's out of credits) but keeps the key for the targeted "sales but no ads" searches. |
| `ADLIBRARY_API_KEY`, `NEXSCOPE_API_KEY`, `WINNINGHUNTER_API_KEY`, `PIPISPY_API_KEY` | The existing licensed data sources. |


## Daily pipeline

After the morning imports, one chain runs at 08:05 UTC (`convex/productPipeline.ts`): image hashes → link ads
to products → landing-page prices → merge duplicates → store catalog checks → scores → Winning Products (score
and winner gates) → history → Research and site counts → morning digest. Admin shows each step's timing and can
re-run from any step.

## Things to review in Admin

- **Product scores**: the new calibrated scores next to the live ones; press "Switch to new scores" when happy.
- **Revenue calibration**: add 20–50 stores or products with known monthly revenue; estimates are checked
  against them monthly.
- **Merge duplicates** runs daily as part of the pipeline; the merged count shows on the pipeline card.

## Morning digest, niches and alerts

- After sign-up, users pick the niches they sell in. Winning Products, Products and Ad Spy show those first
  (a "My niches" chip turns it off); Settings → My niches changes them in one tap.
- The morning digest goes out at 8:00 in each user's own timezone: their top 5 new winners in their niches plus
  the day's alerts, with an unsubscribe link and a one-click List-Unsubscribe header. Hourly cron + the end of
  the daily pipeline.
- Pro (and the 7-day trial) can follow advertisers and products. Alerts: new ads, and a product's score reaching
  the chosen number. They show under Alerts and in the morning email.
- Testimonials: add 3–5 real ones in `src/content/testimonials.ts`; the section stays hidden until then.
- Data & methodology page: `/methodology` (footer and pricing link to it).

## Verification checklist (about 15 minutes)

1. **Routes**: open `/signup`, `/sign-in` and `/pricing` → Login and the pricing section. View the source of `/`:
   the stat numbers are in the HTML.
2. **Pricing**: €35 / €30 toggle works; signed out the Pro button says "Start 7-day free trial".
3. **Trial**: sign in with a new account → Settings → "Start 7-day free trial" → lists show every result; the
   plan badge says "Pro · free trial".
4. **Onboarding**: a new account is asked for niches; Winning Products shows "My niches"; Settings changes them.
5. **Product page**: score breakdown (after switching to new scores), one revenue figure with a confidence label,
   "#N in <niche>" badge only on gated winners, no "—" or "Unknown" anywhere, "Competition this week".
6. **Admin**: pipeline card shows every step with timings; Product scores card shows old vs new distribution;
   "Kept out by winner gates" and "Duplicates merged" counts; Revenue calibration accepts known stores.
7. **Mobile (360 px)**: bottom bar reads Home · Winners · Products · Ad Spy · Hooks; "Ask AI" is in the top bar;
   Ad Spy shows 4 filters plus "Advanced filters".
8. **Alerts**: on a Pro account follow a product (with "Score reaches 80") and an advertiser; next day's alerts
   appear under Alerts and in the morning email.
9. **Email**: with Resend verified, turn the digest on and wait for 8:00 your time; the unsubscribe link turns it off.

## Test-decision features (roadmap P1)

- **Should I test this?** on every product page: Demand, Room left (competition in the user's country, set at
  onboarding or in Settings), Margin and Angle bank, with one plain verdict line (`convex/lib/verdict.ts`).
- **Suppliers**: the top 3 AliExpress matches with price, rating and 30-day orders; Open / Copy link.
- **Scaling** filter in Ad Spy: ads running 14+ days whose views grew 10%+ in a week or whose engagement is at or
  above their niche's median (`convex/lib/scaling.ts`).
- **North star** (Admin): weekly validated tests per active user (verdict seen + product saved) and the funnel.

## Roadmap P2

- **Store watchlist**: watch up to 5 stores on Free, 50 on Pro. Alerts for new products, price changes, sales jumps
  and new ads linking to the store's domain; the store popup shows its ads and its catalog with estimated 30-day
  orders, reviews and first-seen dates.
- **TikTok Shop** tab: TikTok Shop best-sellers ranked by estimated monthly sales (Nexscope data; no scraping).
- **Angles**: Hooks of the week shows each niche's crowded angle and the angles no winning hook uses yet.
- **Transcripts**: spoken hooks from video ads (needs `DEEPGRAM_API_KEY`).


## Public API (roadmap P3-B)

Paid accounts use the same keys as the MCP connector (Settings → Connect your AI app or the API), as
`Authorization: Bearer <key>` or `?key=<key>`, on the Convex HTTP host (`https://<deployment>.convex.site`):

- `GET /v1/products`: search, category, maxPrice, minMargin, trend, winnerOfDayOnly, sort, limit (1–15)
- `GET /v1/ads`: search, niche, platform, country, mediaType, minDaysRunning, sort, limit (1–15)
- `GET /v1/niches`

Answers are `{ "data": [...] }` or `{ "error": "..." }` (401 bad key, 403 not paying, 400 bad parameters,
429 daily cap). MCP and the API share the daily cap `MCP_DAILY_LIMIT` (default 300 per user).

## Multi-source fusion

Apify, Meta's Ad Library (official API and AdLibrary) and marketplace data (Nexscope: Amazon, TikTok Shop,
Shopify) feed one record per ad and product (`convex/lib/fusion.ts`, `convex/fusion.ts`).

- **Provenance**: each ad lists every source that delivered it (`sources`) and who wrote its live status,
  advertiser and engagement (`sourceFields`). Priorities: live status and advertiser name from the official
  registry over Apify; engagement from Apify and ad-spy feeds; price from the store's own page over
  marketplace data over ad text. Disagreements are logged (`sourceConflicts`, 90 days) and sampled in
  Admin → Source fusion.
- **Verified winners (⭐)**: a winner whose sources agree: a live ad in the official registry with rising
  engagement, marketplace sales with ads scaling, a known margin and low competition. Products show which
  sources back them on their page.
- **Triggers** (pipeline stage "fusion", after the winners are rebuilt):
  - new winner → Apify pulls its advertiser's ads;
  - advertisers in a niche × country double in a week (5+ new) → alert that niche's watchers, one Apify pass;
  - marketplace best-seller with no ads → one AdLibrary search for its brand (one search credit each, uses
    `ADLIBRARY_API_KEY`); without an AdLibrary key, Meta's free official API (`META_ACCESS_TOKEN`).
  - ad-only product → its Amazon twin by image (Nexscope `reverse-product-image-search`): shown on the product page and counted as
    marketplace demand (`FUSION_IMAGE_MATCH_PER_DAY`, default 10);
  - winner → 1688 wholesale offers by image (Nexscope `1688-search-by-image`), shown under Suppliers next to AliExpress
    (`FUSION_WHOLESALE_PER_DAY`, default 10). Each product is re-checked at most monthly. If Nexscope's reply has fields
    we don't read yet, Admin → Source fusion lists them.
- If AdLibrary runs out of credits, the "sales but no ads" lookup switches to Meta's API for the rest of the run.
- **Budget**: triggered Apify runs share `APIFY_DAILY_BUDGET_USD` (default 10), winners first; each run is
  capped (about $0.07). Per day: `FUSION_ENRICH_PER_DAY` (default 10 winners), `FUSION_BACKFILL_PER_DAY`
  (default 20 products).
- Before marketing "Verified winners", confirm the Nexscope contract allows derived scores built on its data.

## Launch (one-click product pages in Shopify)

A **Launch** button on product pages writes a product page with Claude (from the product's facts, its real supplier
order count and the ads already selling it), cleans unprovable claims, and creates it in the user's Shopify store as a
draft (or live), with price from supplier cost × ~2.8, images, SEO and an ad kit. History: `/dashboard/launches`.
Quota: Pro 10 pages/month (`LAUNCH_MONTHLY_PRO`), Pro trial 2, agency/admin unlimited. Big-brand products are blocked.

Stores connect through the **AdSpy Pro Shopify app** (OAuth, `convex/shopifyApp.ts`); pasted custom-app tokens still
work for stores that already have one. Setup:

1. Shopify Dev Dashboard → create the app "AdSpy Pro – Launch". Redirect URL:
   `https://careful-raccoon-363.convex.site/shopify/callback`. Copy its client ID into `shopify-app/shopify.app.toml`
   and run `npx @shopify/cli@latest app deploy` in `shopify-app/` (scopes and webhooks).
2. Convex (Production) env: `SHOPIFY_API_KEY` (client ID), `SHOPIFY_API_SECRET` (client secret), `SHOPIFY_TOKEN_KEY`
   (32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
3. Until the app passes Shopify's review, it can be installed on development stores and with custom distribution links.

### Full store

Launch → **Full store** builds a whole store around the product in one of six styles (`convex/lib/storeStyles.ts`):
Claude writes the home page, About, FAQ, Shipping & returns and Contact pages and menu labels from the product, its ads
and the shipping/returns facts the user enters (`convex/lib/storeKit.ts`). The job creates the product, the pages, two
menus with our own handles (`adspy-main`, `adspy-footer`, so the live theme's menus aren't touched) and installs our
storefront theme (`shopify-theme/`) as an **unpublished** theme. Shopify downloads the theme zip from
`/shopify/theme.zip` (signed with `SHOPIFY_TOKEN_KEY`, `convex/storeThemeHttp.ts`). The user previews it and clicks
"Make it my live store" to publish it. Prices are converted from USD to the store's currency with the daily ECB rates.

- Needs the scopes `write_themes`, `write_online_store_pages` and `write_online_store_navigation` (in `SHOPIFY_SCOPES`
  and `shopify-app/shopify.app.toml`). App installs from before them get a "Reconnect" prompt. Pasted custom-app tokens
  need those scopes added to the custom app in Shopify admin. A public Shopify app also needs Shopify's `write_themes`
  exemption before listing.
- After editing `shopify-theme/`, run `node scripts/build-theme.mjs` (bundles it into
  `convex/lib/themeFiles.generated.ts`; `convex/storeTheme.test.ts` fails while it's out of date).
