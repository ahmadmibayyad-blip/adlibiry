# Shopify app review checklist — week-1 submission

Goal: submit the AdSpy Pro Shopify app for review in week 1–2 and run the beta on
development stores + single-store installs while review runs. Review currently
takes **about 5–6 weeks**, so the submission must go in early with a deliberately
small scope.

**Scope for v1 (keep it exactly this):** OAuth install → create the product as a
**draft** via `productSet` (description HTML, price/cost, images, SEO, `adspy.page`
metafield) → optional live publish. No theme writes, no app block in v1, no
Shopify Billing.

## Day 1–2 — app skeleton + credentials

- [ ] Partner account created (must belong to you/your company, not an agency login).
- [ ] Public app created (name e.g. *AdSpy Pro – Launch*); client ID/secret copied.
- [ ] `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_TOKEN_KEY`, `CONVEX_SITE_URL`, `SITE_URL` set on the Convex deployment (`launch_modules/ENV_AND_SETUP.md` §1).
- [ ] Redirect URL registered exactly: `https://<deployment>.convex.site/shopify/callback`.
- [ ] Store appears in AdSpy Pro after OAuth on a dev store; token stored as `enc:v1:` (never raw).

## Day 3 — correctness + webhooks

- [ ] `GET /shopify/callback` verifies the query HMAC; forged/replayed callbacks are refused (covered by `convex/launch.test.ts`).
- [ ] Webhooks subscribed on all four mandatory topics: `app/uninstalled`, `customers/data_request`, `customers/redact`, `shop/redact` → `https://<deployment>.convex.site/shopify/webhooks`; bad HMAC → 401 (test: send a bogus signature).
- [ ] Uninstall the app on the dev store → the connection is deleted (verify in the DB / reconnect UI).
- [ ] Privacy topics: we store no customer data — `customers/*` returns 200 with no action; document that in the review notes.

## Day 4 — listing + review answers

- [ ] Scopes on the listing match `SHOPIFY_SCOPES` and each is justified:
  `write_products` (create/update launched products), `read_products`,
  `write_publications` + `read_publications` (put ACTIVE products on the Online
  Store). If v1 ships draft-only, drop the publications pair — smaller scope
  reviews faster.
- [ ] Privacy policy and terms URLs are live; support email/URL on the listing.
- [ ] Core-functionality description matches reality: "turns winning products into
  ready-made product pages in your store, written from the ads already selling them."
- [ ] Screenshots of the flow (product → Launch dialog → draft in store admin) +
  a short demo video — review teams commonly ask for the video.
- [ ] **Billing answer prepared:** the Shopify app is free; charging happens in
  AdSpy Pro via Stripe (the app is a connector to an external SaaS). Raise this
  explicitly during review **before** public launch. Fallback if Shopify insists:
  mirror the AdSpy Pro plan as a Shopify Billing plan at the same price.

## Day 5 — submit + parallel applications

- [ ] Submit for review (keep it draft/unlisted for the beta; flip to listed on approval).
- [ ] Apply for the `write_themes` exemption (reason: "page builder") — only needed
  for our own storefront theme in Phase 2. Level 1 (description HTML) and Level 2
  (theme app extension placed by the merchant) work without it.
- [ ] Shopify affiliate program application, so "Start your Shopify store" earns commission.

## During review (weeks 2–6)

- [ ] Beta runs on dev stores + single-store installs; distribute via the dev-store
  install path, never ask merchants for tokens.
- [ ] Keep the pasted-token connect flow for **existing** connections until the app
  is approved; retire it after.
- [ ] Watch for review feedback daily; answer within 24h to stay in queue.
- [ ] Theme app extension (the "AdSpy page" block reading `product.metafields.adspy.page`)
  + embedded admin page (`shopify-app/`) can be built while review runs.

## Release gates on approval

- [ ] One clean run of `ENV_AND_SETUP.md` §3 Path A on a fresh dev store.
- [ ] Quota behavior verified (trial cap 2, Pro 10/mo, agency unlimited, failures free).
- [ ] `launch_published`-style north-star event visible in the funnel dashboard.
- [ ] Flip the app to listed; announce to Pro users.
