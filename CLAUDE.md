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

## Environment and secrets

- Convex env vars are set per deployment: Convex dashboard → **Production** deployment → Settings → Environment Variables.
  Project "Default Environment Variables" don't reach the existing production deployment.
- Never ask for API keys, client secrets or tokens in chat. Tell the user where to set them.
- Claude API calls go through `claudeClient()` in `convex/lib/claudeClient.ts` (it adds the workspace header).

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

## UI

- Components: shadcn/ui in `src/components/ui`, icons from `lucide-react`, toasts via `sonner`, charts via `src/pages/dashboard/_components/charts.tsx`.
- Filters use dropdowns (`src/components/FilterSelect.tsx`), not chip rows. The Products page starts in grid view.
