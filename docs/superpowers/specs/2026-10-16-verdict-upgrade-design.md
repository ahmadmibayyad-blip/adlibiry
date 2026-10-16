# Research verdict upgrade: design

Date: 2026-10-16. Status: waiting for review. Branch: `claude/verdict-upgrade`.

## Goal

Make the AI research verdict on the product page (`ai.researchProduct`, `lib/researchReport.ts`) consistent and honest for every seller:

1. **Fixed rules:** code sets the highest verdict allowed. The AI may only go lower.
2. **Hard-blocker check:** brand, margin, shipping and AI-flagged blockers mean **skip**.
3. **VAT and local currency:** profit after VAT where it applies, with amounts in the user's display currency.
4. **Own-store sales:** orders of a product the user launched through AdSpy count as a demand signal.

The user decided: one project; code sets a ceiling; own-store sales only for products launched through AdSpy.

## 1. Verdict rules (`convex/lib/verdictRules.ts`, pure)

### Demand signals (each must be seen)

| Key | Signal | Rule |
|---|---|---|
| `ads` | Ads | longest-running ad ≥ 30 days and ≥ 2 advertisers |
| `supplier` | Supplier orders | ≥ 1,000 orders in the last 30 days (matched AliExpress supplier) |
| `adspy` | AdSpy demand check | the `verdict()` "demand" check is `ok === true` (≈ $10K+/month, views not falling) |
| `tiktok` | TikTok Shop | `unitsPerMonth` ≥ 1,000 on a TikTok Shop product |
| `ownStore` | Your store | ≥ 3 orders of the launched product in the last 30 days |

### Hard blockers (any one means the ceiling is skip)

- **Break-even ad cost under $8** on a seen price (not an assumed one). Where VAT applies, this uses the after-VAT profit.
- **Famous brand:** `bigBrandIn(title + description)` from `lib/productMatch.ts` finds a famous brand.
- **Known shipping over 15 days** (when the data has a delivery time).

### Ceiling

- `skip` if any hard blocker applies.
- Otherwise `research` if any of these hold:
  - fewer than 2 signals
  - the supplier cost is unknown
  - the price is assumed (no seen selling price)
- Otherwise `test`.

### Final verdict

`final = lowest(ai.call, ceiling)`, with the order test > research > skip.

If the AI marks any risk `blocker: true`, the final verdict is `skip`. That covers restricted ad categories, trademarks the detection missed, and similar cases.

### Stored and shown

The report keeps:
- `call` (final) and `aiCall`
- `rules: { signals: {key, seen, detail}[], blockers: string[], ceiling, cappedBy?: string }`
- `rulesVersion: 2`

Under the verdict, show "Why this verdict", for example: *"2 of 5 demand signals · cost known · break-even $14 after VAT"*. When the ceiling lowered the AI's verdict: *"Capped at research more: supplier cost unknown"*.

Reports without `rulesVersion` stay as they are, with "Made with older rules · Refresh".

The AI prompt (`RESEARCH_SYSTEM`) tells the AI the ceiling, the signals and the blockers, so it can explain them. It doesn't decide them.

## 2. VAT and local currency

### `convex/lib/vat.ts` (pure)

`VAT_RATES` holds standard rates:
- the 27 EU countries
- GB 0.20, NO 0.25, CH 0.081, AU 0.10, NZ 0.15

`vatRate(country?: string): number | null` returns `null` for countries without included VAT (US, CA, …) or an unset country.

### Margin

- `marginMath` stays unchanged (USD, the app's number).
- New `withVat(margin, rate)` returns `{ netPrice, profitAfterVat, breakEvenAfterVat }`, where net price = price ÷ (1 + rate).
- The blocker test and the test rule use `profitAfterVat` when a rate applies, otherwise `profit`.

Example: price $43.20, cost $10.10, DK 25%:
- fees 43.20 × 0.029 + 0.30 = $1.55
- profit $31.55
- net $34.56, so profit after VAT is $22.91

### Country and currency

- **Country:** `users.targetCountry`. If it's unset, there's no VAT line, and the verdict shows "Set the country you sell to" (a link to the existing setting).
- **Currency:** amounts are shown in `users.displayCurrency`, using the existing daily rates (`convex/currency.ts`), with a note like "1 $ = 6.93 kr, rate of 16 Oct". Rules run in USD.
- **AI input:** the AI gets precomputed lines in both currencies. It never computes VAT or converts currencies.

## 3. Own-store sales

### Permission

- Add `read_orders` to `SHOPIFY_SCOPES` (`convex/lib/shopifyOAuth.ts`) and to `shopify.app.toml`.
- Add an exported `missingOrderScope(granted?: string): boolean`, following `missingStoreScopes`.
- **One-time steps for the user (not code):**
  1. Request **protected customer data access, level 1** for orders in Shopify's Dev Dashboard.
  2. Release the app version that includes the new scope.

### Counting

- **Which product:** the user's newest `published` launch for this product, on the currently connected shop, that has a `shopifyProductId`.
- **Query:** GraphQL `orders(query: "created_at:>=<now−30d>")`, 250 per page. Select only `lineItems { product { id } quantity }` and no customer fields.
- **Cap:** stop after 1,000 orders and mark the result `capped`.
- **Result:** the number of orders that contain the product.
- **Cache:** on the launch row, `ownOrders30d?: number`, `ownOrdersAt?: string`, `ownOrdersCapped?: boolean`. Refresh when it's older than 12 hours.
- **Signal:** `ownStore` is seen when `ownOrders30d ≥ 3`.
- **Shown:** e.g. *"Your store: 7 orders in 30 days"*.

### Failure handling

Missing scope, an invalid token or a Shopify error makes the signal "unknown". The verdict still runs.

When the scope is missing:
- OAuth installs see *"Reconnect your store to count your own sales"* (the existing reconnect flow), on the verdict panel and in Settings → Shopify.
- Stores connected with a pasted token see *"Add read_orders to your app's access scopes"*.

## Testing

- **Unit (vitest) for `verdictRules`:**
  - each signal at its threshold and one below it
  - each blocker
  - each cap reason
  - an assumed price never causes a margin skip
  - an AI blocker forces skip
  - `lowest()` order
- **Unit for `vat`:**
  - rates for DK, DE, GB and US (null)
  - the `withVat` worked example above
  - US margin unchanged
- **Convex tests for `researchProduct`** with Shopify `fetch` mocked:
  - orders containing the product, giving `ownStore` seen
  - scope missing, giving unknown plus the reconnect flag
  - a Shopify error, giving unknown
  - a cache younger than 12 hours, giving no fetch
- **Existing tests** (`researchVerdict.test.ts`, `launch.test.ts`, `storeCheck.test.ts`) keep passing.
- **Live check** on the test store Dråbefri, after the Dev Dashboard steps.

## Out of scope

- Matching store products by title (only launched products are counted).
- Product list verdict badges showing the rules line (they show the final verdict as today).
- The user's Claude skills (`product-method.md`). They already match these rules.
