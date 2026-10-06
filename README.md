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
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` | Supplier cost (landed cost) from the AliExpress Affiliate API, for margins. Optional: `ALIEXPRESS_TRACKING_ID`, `ALIEXPRESS_SHIPPING_USD` (shipping estimate added to the price, default 3). |
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
