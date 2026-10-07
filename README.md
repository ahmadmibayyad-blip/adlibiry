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
| `META_ACCESS_TOKEN` | Daily import from Meta's official Ad Library API (EU commercial ads). Needs a Meta developer app with Ad Library API access (identity verification). Optional: `META_AD_COUNTRIES` (default `DK,SE,DE,NL,FR`), `META_GRAPH_VERSION` (default `v23.0`). |
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` | Supplier sourcing from the AliExpress Affiliate API: the top 3 suppliers per product (product page → Suppliers) and the landed cost for margins. `ALIEXPRESS_TRACKING_ID` makes supplier links affiliate links (commission on orders); `ALIEXPRESS_SHIPPING_USD` is the shipping estimate added to the price (default 3). |
| `DEEPGRAM_API_KEY` | Video ad transcripts: the line spoken in the first 3 seconds becomes the ad's hook in Hooks of the week (about 40 videos a day, scaling ads first). |
| `ADLIBRARY_API_KEY`, `NEXSCOPE_API_KEY`, `WINNINGHUNTER_API_KEY`, `PIPISPY_API_KEY` | The existing licensed data sources. |

The daily Apify job that scraped facebook.com/ads/library is turned off (scraping Meta is against its terms).

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

