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
- Launch → "Special requests" (`launches.wishes`): added to every AI brief in launchRun; for a Full store on our theme a small request reads
  look changes from it (`lib/designWishes.ts`, saved as `launches.design`), applied over the style and a mirrored look.

## UI

- Components: shadcn/ui in `src/components/ui`, icons from `lucide-react`, toasts via `sonner`, charts via `src/pages/dashboard/_components/charts.tsx`.
- Filters use dropdowns (`src/components/FilterSelect.tsx`), not chip rows. The Products page starts in grid view.
