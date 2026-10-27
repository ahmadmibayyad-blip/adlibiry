# Istilam for Shopify — design

Date: 2026-10-27. Status: approved in chat (flow + admin/billing/review), spec awaiting review.

## Goal

A public Shopify App Store app that does what Istilam does on Salla: every new cash-on-delivery order gets a
WhatsApp message with Confirm / Cancel / Edit address buttons, and the order updates in Shopify from the answer, so
merchants ship only confirmed orders. Built while the Salla listing waits for ID verification.

Success: on a Shopify development store, a COD order is held, the WhatsApp message arrives, Confirm releases the
hold and Cancel cancels with restock; the embedded dashboard shows it; a test-mode subscription gates usage; the app
passes Shopify's automated checks and is ready to submit for App Store review.

## Decisions

| Topic | Decision |
| --- | --- |
| Distribution | Public App Store app (separate app "Istilam", not part of AdSpy Pro's Shopify app) |
| Hosting | Convex only (careful-raccoon-363), same as Salla. No new frontend host |
| Install / auth | Shopify managed installation (scopes in `shopify.app.toml`) + token exchange for an offline token |
| Admin UI | One embedded page served by a Convex httpAction; App Bridge + Polaris web components from Shopify's CDN |
| Languages | Arabic + English (follows the admin locale); French later |
| WhatsApp | Same Meta number, templates and reminder timings as Salla |
| Pricing | Shopify Billing API: Confirm $13 (500/mo), Confirm Pro $27 (3,000/mo, recommended), Confirm Unlimited $53, Confirm Pro Yearly $264; 7-day trial |
| Data | New `shopifyCod*` tables; Salla tables untouched; platform-neutral logic moved to shared `convex/lib` |

Out of scope for v1: French, changing the Shopify shipping address automatically, per-store WhatsApp numbers
(Embedded Signup), SMS fallback, POS orders.

## Order flow

1. **`orders/create` webhook** (HMAC checked with the app's client secret, deduped by `X-Shopify-Webhook-Id`).
   The order is COD when `payment_gateway_names` contains a COD gateway (`Cash on Delivery (COD)` or a name matching
   /cash on delivery|cod|الدفع عند الاستلام/i) and `financial_status` is `pending`. Other orders are ignored.
2. **Gate.** Skip (counted as skipped) when the app is off, the plan is inactive or the monthly limit is reached.
   A refuser hash match follows the merchant's setting: flag, or cancel straight away.
3. **Hold.** For each fulfillment order of the order: `fulfillmentOrderHold` (reason `OTHER`, note
   "Istilam: waiting for the customer's WhatsApp confirmation"). Add tag `istilam:pending`.
4. **Send.** Phone from `shipping_address.phone`, else `billing_address.phone`, else `customer.phone`, normalised to
   E.164 with the shipping country. Template `cod_order_confirm` (env `WHATSAPP_TEMPLATE`), params: customer first
   name, shop name, order name (`#1001`), total with currency. Buttons carry `shp:<shopKey>:<orderId>:<c|x|a>`.
   No phone → error `no_mobile`, hold released so the order isn't stuck.
5. **Reminders** after 2 h and 24 h, auto-cancel 24 h after the last reminder (same constants as Salla).
6. **Answers** (via the existing Meta webhook, which routes `shp:` payloads to Shopify and `cod:` to Salla):
   - Confirm: `fulfillmentOrderReleaseHold` on held fulfillment orders, tag `istilam:confirmed`, remove `istilam:pending`.
   - Cancel: `orderCancel` (reason `CUSTOMER`, `restock: true`, `refund: false`, `notifyCustomer: false`),
     tag `istilam:cancelled`.
   - Edit address: ask for text or a map pin (as Salla); the answer is appended to the order note
     (`orderUpdate`) with `istilam:address` tag. The hold stays until Confirm.
7. **Refusals.** `orders/cancelled` or `refunds/create` on an order we recorded as confirmed (and not cancelled by
   us) adds the phone hash to `shopifyCodRefusers`.
8. **Shop changes outside the app.** `orders/cancelled` on a pending order closes it as cancelled (no more reminders).
   A manual hold release in Shopify admin is respected: we don't re-hold.

## Install, auth and webhooks

- `shopify.app.toml` (in `shopify-istilam/`, deployed with `shopify app deploy`): `embedded = true`,
  `application_url = https://careful-raccoon-363.convex.site/shopify-istilam/app`, scopes
  `read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders`,
  webhooks `orders/create`, `orders/cancelled`, `refunds/create`, `app/uninstalled`, `app_subscriptions/update`,
  and the compliance topics `customers/data_request`, `customers/redact`, `shop/redact`, all to
  `/shopify-istilam/webhook`.
- This is a separate Shopify app with its own client id. AdSpy Pro's app (`shopify-app/`, `SHOPIFY_SCOPES`) keeps its
  "no write_orders, no customer fields" rule; nothing in the Istilam app touches its config, tokens or tables.
- The page loads with `?shop=&host=&id_token=`. The backend verifies the id token (HS256 with the client secret,
  `aud` = client id, `dest` = shop, `exp`/`nbf`), then token-exchanges it for an offline access token on first load
  and stores it encrypted (same AES helper as Salla). Every later fetch sends a fresh session token from App Bridge
  (`shopify.idToken()`) as `Authorization: Bearer`.
- Env (set by the user in Convex, never in chat): `SHOPIFY_ISTILAM_CLIENT_ID`, `SHOPIFY_ISTILAM_CLIENT_SECRET`.
- `app/uninstalled` and `shop/redact`: delete the shop's token, orders, refusers, usage. `customers/redact`: delete
  that customer's order rows (by Shopify order ids in the payload) and their phone hash from refusers.
  `customers/data_request`: we hold no customer personal data beyond a keyed hash; respond 200 and log the request
  for the merchant (no PII in logs).
- Response headers on the page: `Content-Security-Policy: frame-ancestors https://<shop> https://admin.shopify.com`.

## Billing

- Plan picker on the dashboard calls `appSubscriptionCreate` (`test: true` for development stores, read from
  `shop.plan.partnerDevelopment`), redirects the top frame to the `confirmationUrl` through App Bridge.
- `app_subscriptions/update` and a check on each dashboard load (`currentAppInstallation.activeSubscriptions`)
  keep `shopifyCodShops.plan` current. Tier is mapped from the plan name; limits reuse `TIER_LIMITS`.
- No active subscription → dashboard works, sending is skipped (same as Salla's inactive plan).

## Data model (Convex)

- `shopifyCodShops` {shop (myshopify domain), shopKey (short id used in button payloads), name, tokenEnc, scopes,
  settings {enabled, refusers: "flag"|"cancel", parcelCost}, plan {tier, status, subscriptionId, trialEndsAt,
  currentPeriodEnd, test}, installedAt, uninstalledAt?} — index by_shop, by_key.
- `shopifyCodOrders` {shopKey, orderId, orderName, total, currency, status, phoneHash?, waMessageId?, reminders,
  fulfillmentOrderIds, answeredAt?, lastError?, createdAt, scrubbedAt?} — same indexes as `sallaCodOrders`.
- `shopifyCodRefusers`, `shopifyCodUsage`, `shopifyWebhookEvents`, `shopifyCodSessions` mirror the Salla tables.
- The daily purge (`sallaPurge`) gets a Shopify pass with the same retention (90 days scrub, 1 year delete).

## Shared code

Move to platform-neutral names (re-exported from the old paths so Salla code and tests are unchanged in this PR):
`lib/sallaStats.ts` → `lib/codStats.ts`, `lib/sallaCsv.ts` → `lib/codCsv.ts`, the tier/limit/usage-month parts of
`lib/sallaPlans.ts` → `lib/codPlans.ts`. `lib/whatsapp.ts` gains `shopifyButtonPayload` and a `parseAnyPayload`
returning `{platform: "salla"|"shopify", ...}`; the Salla `parsePayload` stays as is.

## Admin page

Same sections as the Salla dashboard (plan + usage, results, settings, Google Sheets/CSV export, latest orders),
rendered with Polaris web components (`s-page`, `s-section`, `s-switch`, ...). Order names link to
`shopify://admin/orders/<id>`. Plan cards open billing. No custom chrome; title set via App Bridge.

## App Store readiness

- Protected customer data request: level 1 + level 2 fields phone and address (name only for the message greeting),
  with the Salla privacy reasoning: read at send time, never stored, keyed hash only.
- Privacy and FAQ pages: add Shopify sections to `public/istilam/privacy.html` and `faq.html`.
- Listing assets: dashboard screenshots (rendered as for Salla), demo video, 1200×1200 icon from the existing logo.
- Automated checks: session tokens, compliance webhooks, billing API, no pop-ups, HMAC on webhooks.

## Testing

- Unit (vitest): COD detection, phone selection/normalisation, session-token verification (good, wrong aud,
  expired, wrong signature), webhook HMAC, payload parsing for both platforms, plan mapping.
- convex-test: orders/create → hold + send (Shopify and Meta fetch mocked), confirm/cancel/address taps,
  reminders/auto-cancel, refusal webhooks, uninstall/redact cleanup, plan gating, purge.
- Live: Shopify development store with the COD payment method on, the user's test number, recorded like the
  Salla demo.

## What the user does

1. Create the app "Istilam" in the Shopify Partner dashboard and a development store.
2. Paste the client id/secret into Convex env (`SHOPIFY_ISTILAM_CLIENT_ID`, `SHOPIFY_ISTILAM_CLIENT_SECRET`).
3. Run `shopify app deploy` from `shopify-istilam/` (or approve me running it after `shopify auth` login).
4. Fill the protected customer data form and submit for review when everything passes.
