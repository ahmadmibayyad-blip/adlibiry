# Istilam for Shopify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public Shopify app "Istilam" that holds every new COD order, asks the customer on WhatsApp (Confirm / Cancel / Edit address) and releases, cancels or annotates the order from the answer, with an embedded dashboard and Shopify Billing.

**Architecture:** Everything runs on the existing Convex deployment (careful-raccoon-363), next to the Salla app. New `shopifyCod*` Convex modules mirror the Salla ones (`sallaApp` → `shopifyCodApp`, `sallaOrders` → `shopifyCodOrders`, `sallaWhatsapp` → `shopifyCodWhatsapp`, `sallaEmbedded` → `shopifyCodEmbedded`); pure logic lives in `convex/lib`. The one Meta webhook (`/whatsapp/webhook`) routes `shp:` button payloads to Shopify and `cod:` to Salla.

**Tech Stack:** Convex (httpActions, scheduler, convex-test), TypeScript, vitest, Shopify Admin GraphQL `2025-07` (`SHOPIFY_API_VERSION`), App Bridge + Polaris web components from Shopify's CDN, WhatsApp Cloud API.

**Spec:** `docs/superpowers/specs/2026-10-27-istilam-shopify-design.md`

## Global Constraints

- Branch `claude/istilam-shopify` in `~/adlibiry-salla`; one PR per task is fine, or one PR for the lot. No pnpm on this PC: run `npx vitest run <file>`, `npx tsc --noEmit -p convex`, `npx eslint <files>`.
- Every new Convex module gets its `import type` line and `typeof` entry in `convex/_generated/api.d.ts` by hand, alphabetical (see CLAUDE.md).
- Salla behaviour, tables and tests stay unchanged. AdSpy Pro's Shopify app (`shopify-app/`, `SHOPIFY_SCOPES`, `shopifyConnections`) is not touched.
- Never store the customer's phone, name or address. Phone is read at send time and kept only as `phoneHash(wa, SHOPIFY_TOKEN_KEY)`.
- Env (the user sets them in Convex prod, never in chat): `SHOPIFY_ISTILAM_CLIENT_ID`, `SHOPIFY_ISTILAM_CLIENT_SECRET`. Existing: `SHOPIFY_TOKEN_KEY`, `WHATSAPP_*`.
- Scopes: `read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders`.
- Button payload: `shp:<shopKey>:<orderId>:<c|x|a>` (orderId = Shopify's numeric order id as a string).
- Hold note: `Istilam: waiting for the customer's WhatsApp confirmation`. Tags: `istilam:pending`, `istilam:confirmed`, `istilam:cancelled`, `istilam:address`.
- Timings and copy reuse `REMINDER_DELAYS_MS`, `AUTO_CANCEL_AFTER_MS`, `ADDRESS_WINDOW_MS`, `REPLIES`, the template env (`WHATSAPP_TEMPLATE` / `_LANG`) from `convex/lib/whatsapp.ts`.
- Plans (Billing API, USD, 7-day trial): `Confirm` $13 / 30 days → tier `confirm` (500); `Confirm Pro` $27 → `pro` (3,000); `Confirm Unlimited` $53 → `bundle` (no limit); `Confirm Pro Yearly` $264 / year → `pro`.
- Retention: same as Salla (`SCRUB_AFTER_MS` 90 days, `DELETE_AFTER_MS` 1 year, `REFUSER_AFTER_MS` 1 year).
- Before using any Admin GraphQL mutation, check its current shape with the `shopify-plugin:shopify` skill (or the Shopify MCP `validate_graphql_codeblocks`) — names below are as of 2025-07 and `orderCancel`'s refund arguments in particular have moved between versions.

## Decisions this plan adds to the spec

- **No `shopifyWebhookEvents` / `shopifyCodSessions` tables.** Webhook dedupe reuses `internal.sallaApp.markDelivery` with keys `shp:<X-Shopify-Webhook-Id>` (already purged after 30 days). The dashboard authenticates every request with a fresh App Bridge session token, so no session rows.
- **Plan lives on `shopifyCodShops.plan`** (Shopify sends subscription and install through the same app, so the Salla reason for a separate plans table doesn't apply).
- **Gate differs from Salla on purpose:** no active subscription = sending skipped (spec), not unlimited.
- **Offline tokens:** request an expiring offline token in the token exchange if Shopify's current docs require it for new public apps; store `refreshTokenEnc` / `expiresAt` when returned and refresh under a lock like `sallaOrders.accessToken`. Non-expiring token → those fields stay empty.
- **Address replies:** a text or pin is offered to Salla's `takeAddress` first, then Shopify's. A number with open address requests on both platforms at once is not supported.

## Review Focus

1. **COD order without any fulfillment order yet** (Shopify sometimes creates them a moment after `orders/create`) → hold retries once after 60 s, then sends anyway with error `no_fulfillment_order` shown; Confirm/Cancel still work. Test in Task 5.
2. **Phone without country code** (`0555123456`, shipping country SA) → `966555123456`; unknown country and no `+` → `no_mobile`, hold released. Test in Task 2.
3. **Merchant releases or cancels the order in Shopify admin before the customer answers** → reminders stop, no re-hold, a later tap answers `REPLIES.already`. Test in Task 4 / 6.
4. **Webhook delivered twice / out of order** (`orders/cancelled` before our hold ran) → one order row, no hold on a cancelled order. Test in Task 4.
5. **Expired or foreign session token on dashboard calls** (wrong `aud`, `dest` of another shop, expired >5 s) → 401, no data from any shop. Test in Task 2 and 7.

---

### Task 1: Shared COD code and Shopify-aware WhatsApp payloads

**Files:**
- Create: `convex/lib/codPlans.ts`, `convex/lib/codStats.ts`, `convex/lib/codCsv.ts`
- Modify: `convex/lib/sallaPlans.ts`, `convex/lib/sallaStats.ts`, `convex/lib/sallaCsv.ts` (re-export), `convex/lib/whatsapp.ts`
- Test: `convex/lib/whatsapp.test.ts`

**Interfaces:**
- Produces: `codPlans.ts` exports `Tier`, `TIER_LIMITS`, `usageMonth` (moved verbatim; `sallaPlans.ts` re-exports them). `codStats.ts` = all of `sallaStats.ts` except `readIntrospect` (Salla-only, stays). `codCsv.ts` = all of `sallaCsv.ts`. Old files `export * from "./codX"` plus their Salla-only parts.
- Produces in `whatsapp.ts`:
  - `shopifyButtonPayload(shopKey: string, orderId: string, tap: Tap): string`
  - `parseAnyPayload(p: string): { platform: "salla"; merchantId: number; orderId: string; answer: Tap } | { platform: "shopify"; shopKey: string; orderId: string; answer: Tap } | null`
  - `confirmMessageWith(to, p: ConfirmParams, payloadFor: (t: Tap) => string, template?)` and `answerButtonsWith(to, body, payloadFor)`; `confirmMessage` / `answerButtons` become one-line wrappers passing `(t) => buttonPayload(merchantId, orderId, t)`.

- [ ] **Step 1: Write failing tests** in `whatsapp.test.ts`:

```ts
it("round-trips Shopify payloads and keeps Salla ones", () => {
  expect(shopifyButtonPayload("k3x9a0b2cq", "5512345678901", "address")).toBe("shp:k3x9a0b2cq:5512345678901:a");
  expect(parseAnyPayload("shp:k3x9a0b2cq:5512345678901:c")).toEqual({ platform: "shopify", shopKey: "k3x9a0b2cq", orderId: "5512345678901", answer: "confirmed" });
  expect(parseAnyPayload("cod:212746149:445306537:x")).toEqual({ platform: "salla", merchantId: 212746149, orderId: "445306537", answer: "cancelled" });
  expect(parseAnyPayload("shp::1:c")).toBeNull();
  expect(parseAnyPayload("shp:k3x:1:z")).toBeNull();
});
it("builds the template with Shopify payloads", () => {
  const m = confirmMessageWith("966555123456", { customer: "Sara", store: "Nordform", reference: "#1001", total: "199.00 SAR" },
    (t) => shopifyButtonPayload("k3x9a0b2cq", "1", t), { name: "cod_order_confirm_v3", language: "ar" });
  expect(JSON.stringify(m)).toContain("shp:k3x9a0b2cq:1:a");
});
```

- [ ] **Step 2:** `npx vitest run convex/lib/whatsapp.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Move the shared code, add the helpers. `shopKey` pattern `[a-z0-9]{6,16}`, orderId `\d+`.
- [ ] **Step 4:** `npx vitest run convex/lib convex/salla*.test.ts` → all PASS (Salla tests untouched); `npx tsc --noEmit -p convex` clean.
- [ ] **Step 5:** Commit `Istilam: shared COD plans/stats/CSV, Shopify button payloads`.

### Task 2: Pure Shopify logic — COD detection, phone, plans, session token

**Files:**
- Create: `convex/lib/shopifyCod.ts`, `convex/lib/shopifySessionToken.ts`
- Test: `convex/lib/shopifyCod.test.ts`, `convex/lib/shopifySessionToken.test.ts`

**Interfaces:**
- Produces (`shopifyCod.ts`):
  - `isCodOrder(o: { payment_gateway_names?: unknown; financial_status?: unknown }): boolean` — true when a gateway name matches `/cash on delivery|\bcod\b|الدفع عند الاستلام/i` and `financial_status === "pending"`.
  - `codOrderFromWebhook(body: Record<string, unknown>): { orderId: string; orderName: string; total?: number; currency?: string } | null` — `id`, `name`, `total_price`, `currency`; null when not COD.
  - `DIAL_CODES: Record<string, string>` — at least SA 966, AE 971, KW 965, QA 974, BH 973, OM 968, EG 20, JO 962, MA 212, DZ 213, TN 216, IQ 964, DK 45, FR 33, GB 44, US 1.
  - `waNumberFrom(phone: unknown, countryCode: unknown): string | null` — `+`/`00` prefix: digits as given; otherwise strip leading zeros and prefix `DIAL_CODES[country]`; unknown country → null; result 9–15 digits.
  - `pickPhone(o: ShopifyPhoneOrder): string | null` where `ShopifyPhoneOrder = { shippingAddress?: {phone?, countryCodeV2?}|null; billingAddress?: …; customer?: { defaultPhoneNumber?: { phoneNumber?: string } | null } | null }` — first usable of shipping, billing, customer (customer uses shipping country, else billing).
  - `SHOPIFY_PLANS: readonly { name: string; amount: number; interval: "EVERY_30_DAYS" | "ANNUAL"; tier: Exclude<Tier, "trial"> }[]` — the four plans from Global Constraints. `TRIAL_DAYS = 7`.
  - `tierForPlanName(name: string): Exclude<Tier, "trial"> | null`.
  - `shopGate(plan: ShopPlan | undefined, now: number): { active: boolean; limit: number | null }` where `ShopPlan = { tier: Tier; status: string; currentPeriodEnd?: number }` — active only for status `ACTIVE` and (`currentPeriodEnd` missing or `now <= currentPeriodEnd + GRACE_MS`).
- Produces (`shopifySessionToken.ts`): `verifySessionToken(jwt: string, clientId: string, secret: string, now: number): Promise<{ shop: string } | null>` — HS256 only, `aud === clientId`, `exp > now/1000 - 5`, `nbf <= now/1000 + 5`, `dest` = `https://<x>.myshopify.com` → shop `<x>.myshopify.com`, `iss` must start with `dest`. Uses `safeEqual` from `lib/shopifyOAuth`.

- [ ] **Step 1: Write failing tests.** Exact cases:
  - `isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"], financial_status: "pending" })` true; `["shopify_payments"]` false; COD with `"paid"` false; `["الدفع عند الاستلام"]` pending true; `["Codex Pay"]` false.
  - `waNumberFrom("0555123456", "SA")` → `"966555123456"`; `"+966 55 512 3456"` → `"966555123456"`; `"00966555123456"`, `"DK"` → `"966555123456"` (explicit prefix wins over the country); `"55512345"`, `"ZZ"` → null; `"12"`, `"SA"` → null.
  - `pickPhone` with no shipping phone falls back to billing; all empty → null.
  - `tierForPlanName("Confirm Pro Yearly")` → `"pro"`; `"Unknown"` → null. `shopGate(undefined, now)` → `{active:false, limit:null}`; `{tier:"confirm", status:"ACTIVE"}` → `{active:true, limit:500}`; status `"CANCELLED"` → inactive.
  - Session token (sign test tokens in the test with `crypto.subtle` HMAC): valid → `{shop:"istilam-dev.myshopify.com"}`; wrong aud, expired by 10 s, tampered signature, `alg: "none"`, `dest` not myshopify → null.
- [ ] **Step 2:** `npx vitest run convex/lib/shopifyCod.test.ts convex/lib/shopifySessionToken.test.ts` → FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Same command → PASS; lint the two files.
- [ ] **Step 5:** Commit `Istilam Shopify: COD detection, phone numbers, plans, session tokens`.

### Task 3: App config, tables, install (token exchange) and the Admin API helper

**Files:**
- Create: `shopify-istilam/shopify.app.toml`, `convex/shopifyCodAuth.ts`, `convex/shopifyCodAuth.test.ts`
- Modify: `convex/schema.ts`, `convex/_generated/api.d.ts`

**Interfaces:**
- Schema (add after the Salla tables, comment style as theirs):
  - `shopifyCodShops` {shop, shopKey, name?, tokenEnc?, refreshTokenEnc?, tokenExpiresAt?, refreshLockUntil?, scopes?, enabled: boolean, blockRefusers: boolean, parcelCost?, feedKey?, plan?: {tier, status, subscriptionId?, name?, currentPeriodEnd?, test: boolean}, installedAt, updatedAt, uninstalledAt?} — indexes `by_shop` [shop], `by_key` [shopKey], `by_feed_key` [feedKey].
  - `shopifyCodOrders` — the `sallaCodOrders` fields with `shopKey: v.string()` instead of `merchantId`, `orderName` instead of `referenceId`, plus `fulfillmentOrderIds: v.optional(v.array(v.string()))`, `releasedOutside: v.optional(v.boolean())`; indexes `by_shop_order` [shopKey, orderId], `by_shop_created`, `by_wa_message`, `by_phone_address`, `by_created`, `by_scrubbed_created`.
  - `shopifyCodRefusers` {shopKey, phoneHash, refusals, lastAt} `by_shop_phone`, `by_last`. `shopifyCodUsage` {shopKey, month, sent, skipped} `by_shop_month`.
- Produces (`shopifyCodAuth.ts`):
  - `ensureShop` internalMutation `{shop, tokenEnc, refreshTokenEnc?, tokenExpiresAt?, scopes}` → `{shopKey}`; creates with a random 10-char `[a-z0-9]` shopKey, `enabled: true`, `blockRefusers: false`; on reinstall clears `uninstalledAt` and keeps shopKey/settings.
  - `shopByDomain` / `shopByKey` internalQueries → row | null.
  - `install(ctx: ActionCtx, shop: string, idToken: string): Promise<string /*shopKey*/>` — POST `https://<shop>/admin/oauth/access_token` JSON `{client_id, client_secret, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: idToken, subject_token_type: "urn:ietf:params:oauth:token-type:id_token", requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token"}`; encrypt with `encryptToken(…, SHOPIFY_TOKEN_KEY)`.
  - `shopToken(ctx: ActionCtx, shopKey: string): Promise<{ shop: string; token: string }>` — decrypts; refreshes first when `tokenExpiresAt` is within 5 min (lock via `refreshLockUntil`, 30 s).
  - `gql<T>(ctx, shopKey, query, variables?)` = `shopToken` + `orderGql` from `lib/shopifyOrderApi`, rethrowing `ShopifyError` messages as `Shopify: <msg>` without AdSpy's "Settings → Shopify" wording.
- `shopify.app.toml`: `name = "Istilam"`, `client_id = ""` (user fills), `application_url = "https://careful-raccoon-363.convex.site/shopify-istilam/app"`, `embedded = true`, `[access_scopes] scopes = <Global Constraints>`, `use_legacy_install_flow = false`, `[webhooks] api_version = "2025-07"`, one `[[webhooks.subscriptions]]` with `topics = ["orders/create","orders/cancelled","refunds/create","app/uninstalled","app_subscriptions/update"]` and one with `compliance_topics = ["customers/data_request","customers/redact","shop/redact"]`, both `uri = "https://careful-raccoon-363.convex.site/shopify-istilam/webhook"`; `[auth] redirect_urls = ["https://careful-raccoon-363.convex.site/shopify-istilam/app"]`.

- [ ] **Step 1: Failing convex-test** in `shopifyCodAuth.test.ts` (fetch stubbed):
  - `install` stores an encrypted token (`tokenEnc` starts `enc:v1:`), the exchange body has the five grant fields above; second install of the same shop returns the same shopKey and keeps `enabled: false` if it was turned off.
  - `shopToken` with `tokenExpiresAt` in 1 min calls the refresh grant once even when called twice in parallel.
- [ ] **Step 2:** `npx vitest run convex/shopifyCodAuth.test.ts` → FAIL.
- [ ] **Step 3:** Schema, module, api.d.ts, toml.
- [ ] **Step 4:** Test PASS, `npx tsc --noEmit -p convex` clean.
- [ ] **Step 5:** Commit `Istilam Shopify: app config, tables, token exchange`.

### Task 4: Webhook receiver

**Files:**
- Create: `convex/shopifyCodApp.ts`, `convex/shopifyCodApp.test.ts`
- Modify: `convex/http.ts` (route `POST /shopify-istilam/webhook`), `convex/_generated/api.d.ts`

**Interfaces:**
- Consumes: `verifyWebhookHmac(raw, header, SHOPIFY_ISTILAM_CLIENT_SECRET)`, `internal.sallaApp.markDelivery({key: "shp:"+webhookId})`, `codOrderFromWebhook`, `shopGate`, `usageMonth`, `TIER_LIMITS`.
- Produces internal mutations: `addOrder({shop, order})` → `"held" | "skipped" | "duplicate" | "ignored"` (gate: disabled shop or `!active` or `sent >= limit` → bump `skipped`; else insert `status:"pending"`, bump `sent`, schedule `internal.shopifyCodOrders.hold({shopKey, orderId})`); `orderCancelled({shop, orderId})`; `recordRefusal({shop, orderId})` (confirmed + not cancelled by us → upsert `shopifyCodRefusers`, set `refusedAt`); `forgetShop({shop})` (delete token fields, orders, refusers, usage; set `uninstalledAt`); `redactCustomer({shop, orderIds: string[]})` (delete those order rows and their phone hashes from refusers); `savePlan({shop, subscription})`.
- Topic routing by `X-Shopify-Topic`; shop from `X-Shopify-Shop-Domain`. Bad HMAC → 401. Unknown shop on `orders/*` → 200 and ignored. Always 200 after handling (Shopify retries non-2xx).
- `orders/cancelled` on a pending order: status `cancelled`, `decidedAt` set, no Shopify calls (it's already cancelled), so `sendConfirm` stops at its `status !== "pending"` check.
- `customers/data_request`: 200, `console.log` with shop + request id only.

- [ ] **Step 1: Failing tests** (sign bodies with the test secret like `sallaApp.test.ts`):
  - COD `orders/create` → one `shopifyCodOrders` row `pending`, usage `sent: 1`, `hold` scheduled; same webhook id again → still one row.
  - Non-COD order → no row. Shop with `plan` undefined → row absent, usage `skipped: 1`. `confirm` tier with `sent: 500` → skipped.
  - `orders/cancelled` before hold ran → row `cancelled`; running `hold` afterwards makes no GraphQL call.
  - `refunds/create` on a `confirmed` order → refuser `refusals: 1`; on an order we cancelled → none.
  - `app/uninstalled` and `shop/redact` → no orders/refusers/usage left, `tokenEnc` undefined. `customers/redact` with `orders_to_redact: [id]` → that row gone, other rows stay.
  - Wrong HMAC → 401, nothing written.
- [ ] **Step 2:** `npx vitest run convex/shopifyCodApp.test.ts` → FAIL.
- [ ] **Step 3:** Implement (hold is a stub internalAction in `shopifyCodOrders.ts` until Task 5 if needed for the scheduler reference).
- [ ] **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `Istilam Shopify: webhooks (orders, refunds, uninstall, compliance)`.

### Task 5: Hold, release, cancel and address note in Shopify

**Files:**
- Create: `convex/shopifyCodOrders.ts`, `convex/shopifyCodOrders.test.ts`
- Modify: `convex/_generated/api.d.ts`

**Interfaces:**
- Consumes: `gql` from Task 3.
- Produces:
  - `hold` internalAction `{shopKey, orderId, attempt?: number}`: query `order(id: "gid://shopify/Order/<id>") { name displayFinancialStatus cancelledAt fulfillmentOrders(first: 10) { nodes { id status } } }`; skip if row isn't pending or `cancelledAt` set; `fulfillmentOrderHold(id, fulfillmentHold: { reason: OTHER, reasonNotes: <hold note> })` on each `OPEN` node; `tagsAdd(id, ["istilam:pending"])`; save `fulfillmentOrderIds`, `heldAt`; no nodes and `attempt` unset → reschedule once after 60 s with `attempt: 1`, else record `lastError: "no_fulfillment_order: …"`; then schedule `internal.shopifyCodWhatsapp.sendConfirm({shopKey, orderId, reminder: 0})`.
  - `decide` internalAction `{shopKey, orderId, decision: "confirmed"|"cancelled", note?}`: confirmed → `fulfillmentOrderReleaseHold` on each stored id still `ON_HOLD` (skip and set `releasedOutside` if already released), `tagsAdd istilam:confirmed`, `tagsRemove istilam:pending`; cancelled → `orderCancel(orderId, reason: CUSTOMER, restock: true, notifyCustomer: false, <no refund>)` + `tagsAdd istilam:cancelled`, note (if given) appended to the order note. Sets `decidedAt`, or `lastError` on failure.
  - `releaseHold` internalAction `{shopKey, orderId}` — used for `no_mobile` (release, keep `istilam:pending` off).
  - `appendNote` internalAction `{shopKey, orderId, line: string}` — reads `order.note`, `orderUpdate(input: {id, note: old ? old + "\n" + line : line})`, `tagsAdd istilam:address`.
  - `recordOrder` internalMutation `{shopKey, orderId, ...patch}` (like `sallaOrders.recordOrder`).
- Error text kinds for the dashboard: extend `errorKind` in `codStats.ts` with `"no_fulfillment_order"` and `"shopify"` (match `/^Shopify:/`), keep existing kinds.

- [ ] **Step 1: Failing tests** with a fetch stub that records GraphQL operation names:
  - hold on two OPEN fulfillment orders → two `fulfillmentOrderHold` calls + `tagsAdd`, `sendConfirm` scheduled.
  - no fulfillment orders → rescheduled once; second time `lastError` starts `no_fulfillment_order` and `sendConfirm` still scheduled.
  - decide confirmed with one FO already `OPEN` (released in admin) → no release call for it, `releasedOutside: true`, tags updated.
  - decide cancelled → `orderCancel` variables `{reason: "CUSTOMER", restock: true, notifyCustomer: false}`; `userErrors` non-empty → `lastError` set, `decidedAt` unset.
  - appendNote keeps the old note and adds the line on a new line.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; validate each GraphQL document with the Shopify MCP. **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `Istilam Shopify: hold, release, cancel and notes on orders`.

### Task 6: WhatsApp flow for Shopify orders and the shared webhook router

**Files:**
- Create: `convex/shopifyCodWhatsapp.ts`, `convex/shopifyCodWhatsapp.test.ts`
- Modify: `convex/sallaWhatsapp.ts` (webhook only), `convex/_generated/api.d.ts`

**Interfaces:**
- Consumes: `pickPhone`, `confirmMessageWith`, `answerButtonsWith`, `shopifyButtonPayload`, `parseAnyPayload`, `addressNote`, Task 5 actions. Export `sender` and `waSend` from `sallaWhatsapp.ts` (currently module-private) instead of copying them.
- Produces (`shopifyCodWhatsapp.ts`), each the Shopify twin of the Salla function of the same name, keyed by `{shopKey, orderId}`: `sendConfirm` (GraphQL `order { name totalPriceSet { shopMoney { amount currencyCode } } shippingAddress { firstName phone countryCodeV2 } billingAddress { phone countryCodeV2 } customer { firstName defaultPhoneNumber { phoneNumber } } }` + `shop { name }` cached on `shopifyCodShops.name`; params customer first name or `"عميلنا العزيز"`, shop name, order name, `"<amount> <currency>"`; no phone → `lastError` `"The order has no usable mobile number"` + `releaseHold`; refuser check on reminder 0), `claimAnswer`, `askAddress`, `takeAddress`, `markFailed`, `cancelUnanswered`, `priorRefusals`, `flagRefuser`. `claim` schedules `internal.shopifyCodOrders.decide`.
- `sallaWhatsapp.webhook` changes: `parsePayload` → `parseAnyPayload`, dispatch on `platform`; `failed` events call both `markFailed`s; text/location go to `internal.sallaWhatsapp.takeAddress` then, if null, `internal.shopifyCodWhatsapp.takeAddress`, and the Shopify hit calls `appendNote` with `addressNote(…)`; reply buttons use `answerButtonsWith` with the matching payload builder.

- [ ] **Step 1: Failing tests** (copy the setup block of `sallaWhatsapp.test.ts`):
  - sendConfirm sends the template with `shp:` payloads and the shipping phone normalised; records `phoneHash`, `waMessageId`; schedules reminder 1 after `REMINDER_DELAYS_MS[0]`; after the last reminder schedules `cancelUnanswered` after `AUTO_CANCEL_AFTER_MS`.
  - No phone anywhere → no Meta call, `lastError` set, `releaseHold` scheduled.
  - Signed Meta webhook with button `shp:<key>:<id>:c` from the right number → order `confirmed`, `decide` scheduled, reply `REPLIES.confirmed`; from another number → ignored; second tap → `REPLIES.already`.
  - Order already `cancelled` via `orders/cancelled` → tap answers `REPLIES.already`, no decide.
  - Address tap then a text → `appendNote` scheduled with `addressNote({text})`, reply buttons carry `shp:` payloads.
  - Existing `sallaWhatsapp.test.ts` still passes unchanged.
- [ ] **Step 2:** Run both test files → new ones FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run convex/sallaWhatsapp.test.ts convex/shopifyCodWhatsapp.test.ts` PASS + tsc.
- [ ] **Step 5:** Commit `Istilam Shopify: WhatsApp confirm, reminders and answers`.

### Task 7: Embedded dashboard

**Files:**
- Create: `convex/shopifyCodEmbedded.ts`, `convex/lib/shopifyCodDashboardPage.ts`, `convex/shopifyCodEmbedded.test.ts`
- Modify: `convex/http.ts`, `convex/_generated/api.d.ts`

**Interfaces:**
- Routes: `GET /shopify-istilam/app` (page), `POST /shopify-istilam/app/data`, `POST /shopify-istilam/app/settings`, `POST /shopify-istilam/app/feed` (rotate CSV key), `POST /shopify-istilam/app/billing` (Task 8), `GET /shopify-istilam/feed/<40hex>.csv`.
- `GET /app`: requires `shop` matching `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` (else 400); response header `Content-Security-Policy: frame-ancestors https://<shop> https://admin.shopify.com`; HTML from `dashboardPage({ clientId, locale })`. If `id_token` is in the query and verifies, run `install` when the shop has no token (first open = install).
- POST routes: `Authorization: Bearer <session token>` → `verifySessionToken`; invalid → 401; shop without token → call `install` with that same token, then continue.
- `data` returns the Salla `data` shape (stats via `codStats`, plan `{tier, status, active, limit, sent, skipped, trialEndsAt?}`, settings `{enabled, blockRefusers, parcelCost}`, feedKey, `recent` with `orderName` and numeric `orderId`) — parcel cost default `DEFAULT_PARCEL_COST`, currency label from the shop's orders.
- Page: `<meta name="shopify-api-key" content="<clientId>">`, `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js">`, `<script src="https://cdn.shopify.com/shopifycloud/polaris.js">`; Polaris web components (`s-page`, `s-section`, `s-switch`, `s-text-field`, `s-table`, `s-badge`, `s-button`); fetches with `await shopify.idToken()`; `lang`/`dir` from `locale` (`ar*` → `ar`/`rtl`, else `en`/`ltr`); all copy in a `{ar: {...}, en: {...}}` table using the Salla dashboard's Arabic strings; order names link to `shopify://admin/orders/<id>`; toasts via `shopify.toast.show`.

- [ ] **Step 1: Failing tests:** page without `shop` → 400; page has the CSP header with the shop; data with a valid token → stats for that shop only (insert orders for two shops); token for shop A cannot read shop B (dest A) → only A's rows; expired token → 401; settings saves `enabled`/`blockRefusers`/`parcelCost` (parcel cost rejected by `parseParcelCost` → 400); feed CSV for a rotated key → 404 for the old key.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS + tsc + eslint on new files.
- [ ] **Step 5:** Render the page locally with sample data (as done for Salla screenshots, harness in the scratchpad) in `ar` and `en` and look at it; commit `Istilam Shopify: embedded dashboard`.

### Task 8: Billing

**Files:**
- Modify: `convex/shopifyCodEmbedded.ts`, `convex/lib/shopifyCodDashboardPage.ts`, `convex/shopifyCodApp.ts` (`savePlan`), tests in `convex/shopifyCodEmbedded.test.ts`

**Interfaces:**
- `POST /shopify-istilam/app/billing {plan: <SHOPIFY_PLANS name>}` → `appSubscriptionCreate(name, returnUrl: "https://<shop>/admin/apps/<clientId>", trialDays: TRIAL_DAYS, test: <shop.plan.partnerDevelopment>, lineItems: [{plan: {appRecurringPricingDetails: {price: {amount, currencyCode: USD}, interval}}}])` → `{confirmationUrl}`; the page sends the top frame there with `open(confirmationUrl, "_top")`. Unknown plan name → 400.
- `syncPlan(ctx, shopKey)` — `currentAppInstallation { activeSubscriptions { id name status test currentPeriodEnd trialDays createdAt } }`; called from `data` at most every 10 minutes per shop (`plan.checkedAt`) and from `app_subscriptions/update`; maps with `tierForPlanName`; none → `plan` cleared.
- Dashboard: plan cards for the four plans (Pro marked recommended), current plan highlighted, "no plan → messages are not being sent" banner.

- [ ] **Step 1: Failing tests:** billing for `Confirm Pro` sends amount 27, `EVERY_30_DAYS`, `trialDays: 7`, `test: true` on a development shop; `app_subscriptions/update` ACTIVE `Confirm` → `plan.tier "confirm"`; CANCELLED → `shopGate` inactive and next `orders/create` is skipped.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `Istilam Shopify: plans via the Billing API`.

### Task 9: Retention pass and the public pages

**Files:**
- Modify: `convex/sallaPurge.ts`, `convex/sallaPurge.test.ts`, `public/istilam/privacy.html`, `public/istilam/faq.html`

**Interfaces:**
- `sallaPurge.run` also scrubs `shopifyCodOrders` (`phoneHash`, `waMessageId`, `lastError` → undefined, `scrubbedAt`) after `SCRUB_AFTER_MS`, deletes them after `DELETE_AFTER_MS`, deletes `shopifyCodRefusers` by `lastAt` after `REFUSER_AFTER_MS`; counts returned as `shopifyScrubbed`, `shopifyDeleted`, `shopifyRefusers`; same `BATCH` and reschedule rule.
- Privacy page: a "Shopify" section (Arabic and English like the rest of the page): what we read (order id, number, total, phone/first name/address at send time only), what we keep (keyed hash, ids), retention, uninstall = deletion within 48 h, the three compliance webhooks. FAQ: install on Shopify, COD gateway needed, what Confirm/Cancel do in Shopify (hold, release, cancel + restock).

- [ ] **Step 1:** Failing purge test with a 91-day-old and a 366-day-old Shopify order and an old refuser. **Step 2:** FAIL. **Step 3:** Implement + page text. **Step 4:** `npx vitest run convex/sallaPurge.test.ts` PASS; open both pages locally.
- [ ] **Step 5:** Commit `Istilam Shopify: retention and privacy/FAQ`.

### Task 10: Live run on a development store (with the user)

- [ ] **Step 1:** Full checks: `npx vitest run`, `npx tsc --noEmit -p convex`, `npx eslint` on changed files → all clean. Open the PR, CI green; the user merges (auto mode can't).
- [ ] **Step 2 (user):** Partner dashboard → create app "Istilam", development store, protected customer data: phone, address, name (level 2, "send order confirmations on WhatsApp"); paste client id into `shopify-istilam/shopify.app.toml` (not secret); set `SHOPIFY_ISTILAM_CLIENT_ID` / `SHOPIFY_ISTILAM_CLIENT_SECRET` in Convex prod.
- [ ] **Step 3:** `shopify app deploy` from `shopify-istilam/` (user runs `! shopify auth login` first if needed). Install on the dev store; enable the "Cash on Delivery (COD)" manual payment method.
- [ ] **Step 4:** Pick `Confirm Pro` (test charge), place a COD order with the user's test number (+45 recipient already verified on the Meta test number): expect fulfillment hold + `istilam:pending`, WhatsApp template, Confirm → hold released + `istilam:confirmed`; second order → Cancel → order cancelled, restocked; third → Edit address → note on the order. Dashboard shows all three.
- [ ] **Step 5:** Update memory (`adspy-pro-salla-cod.md` or a new `istilam-shopify.md`) with app id, store, and what's left for review (listing assets, screenshots, demo video, 1200×1200 icon, submit).
