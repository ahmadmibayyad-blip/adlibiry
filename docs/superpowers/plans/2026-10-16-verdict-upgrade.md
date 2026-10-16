# Research Verdict Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product page's AI research verdict follows fixed rules (code sets a ceiling), skips hard blockers, shows profit after VAT in the user's currency, and counts the user's own Shopify orders for launched products.

**Architecture:** Two new pure modules, `convex/lib/vat.ts` and `convex/lib/verdictRules.ts`, decide the numbers and the ceiling. `researchReports.evidence` gathers their inputs. `ai.researchProduct` combines the AI's call with the ceiling, and saves the rules with the report. A new `convex/ownOrders.ts` action counts a launched product's orders through the Shopify Admin API, cached on the launch. `ResearchVerdictCard` shows the "Why this verdict" line, the VAT line and the reconnect prompt.

**Tech Stack:** Convex (TypeScript), vitest with convex-test, React + shadcn/ui, Shopify Admin GraphQL.

**Spec:** `docs/superpowers/specs/2026-10-16-verdict-upgrade-design.md`

## Global Constraints

- Verdict order: test > research > skip. The report's `call` holds the AI words "test" | "research more" | "skip", mapped to the `ResearchCall` values used today.
- Signals:
  - `ads`: longest ad ≥ 30 days AND ≥ 2 advertisers
  - `supplier`: best supplier match `orders` ≥ 1000 (last 30 days)
  - `adspy`: `verdict()`'s demand check `ok === true`
  - `tiktok`: product `source === "tiktok_shop"` AND `unitsPerMonth` ≥ 1000
  - `ownStore`: own orders in 30 days ≥ 3
- Blockers:
  - break-even under $8, on a seen price only (`priceSource !== "estimated_market"` and price present), using the after-VAT profit when `vatRate` isn't null
  - `bigBrandIn(title + " " + description)` isn't null
  - `shippingDays` > 15 (only when known)
- Ceiling:
  - skip if any blocker
  - otherwise research if signals < 2, OR cost unknown, OR price assumed
  - otherwise test
- Final call = the lowest of the AI's call and the ceiling. Any AI risk with `blocker: true` makes it skip.
- VAT rates: the 27 EU standard rates; GB 0.20, NO 0.25, CH 0.081, AU 0.10, NZ 0.15. US, CA and anything else (or unset) return null.
- Own orders:
  - last 30 days, 250 per page, at most 1000 orders scanned (then `capped: true`)
  - select only `lineItems(first: 50) { nodes { product { id } quantity } }`
  - cached on the launch for 12 hours
- Copy (exact):
  - "Why this verdict"
  - "Capped at research more: <reason>"
  - "Made with older rules · Refresh"
  - "Reconnect your store to count your own sales"
  - "Add read_orders to your app's access scopes"
  - "Set the country you sell to"
- `rulesVersion: 2` on new reports.
- Commit identity: `git -c user.name="ahmadmibayyad-blip" -c user.email="ahmadmibayyad@gmail.com" commit …`. No attribution lines.
- Every task ends with `npx tsc --noEmit -p convex` clean, and `npx eslint` clean on the files it touched.

## Review Focus

1. **Price from a category benchmark** (`priceSource: "estimated_market"`) is an assumed price: it must never cause a margin skip, and caps the ceiling at research. Test in Task 2.
2. **Selling country in lowercase or unknown** (`"dk"`, `"XX"`): `vatRate` handles the case and returns null for unknowns, with no crash. Test in Task 1.
3. **The user reconnected a different shop than the one the product was launched to:** no own-order count, signal unknown, no Shopify call. Test in Task 4.
4. **The AI says "test" but lists a blocker risk:** the final call is skip. Test in Task 2.
5. **A shop with more than 1000 orders in 30 days:** stop at 1000, `capped: true`, and the count is still used as the signal. Test in Task 4.

---

### Task 1: VAT table and margin after VAT

**Files:**
- Create: `convex/lib/vat.ts`
- Test: `convex/lib/vat.test.ts`

**Interfaces:**
- Produces:
  - `VAT_RATES: Record<string, number>`
  - `vatRate(country?: string): number | null`
  - `withVat(m: Margin, rate: number): { netPrice: number; profitAfterVat: number; breakEvenAfterVat: number }`
  - Amounts are rounded to cents. `breakEvenAfterVat = max(0, profitAfterVat)`.

- [ ] **Step 1: Write the failing tests** in `convex/lib/vat.test.ts`:
  - `vatRate("DK") === 0.25`, `vatRate("dk") === 0.25`, `vatRate("DE") === 0.19`, `vatRate("GB") === 0.2`
  - `vatRate("US") === null`, `vatRate("XX") === null`, `vatRate(undefined) === null`
  - `withVat(marginMath(43.20, 10.10)!, 0.25)` → `{ netPrice: 34.56, profitAfterVat: 22.91, breakEvenAfterVat: 22.91 }`
  - `marginMath(43.20, 10.10)!.profit === 31.55` (the US margin is unchanged)
  - `withVat(marginMath(10, 9)!, 0.25).breakEvenAfterVat === 0` (a negative profit floors at 0)
- [ ] **Step 2: Run them.** `npx vitest run convex/lib/vat.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `convex/lib/vat.ts`.** The rates: AT .20, BE .21, BG .20, HR .25, CY .19, CZ .21, DK .25, EE .24, FI .255, FR .20, DE .19, GR .24, HU .27, IE .23, IT .22, LV .21, LT .21, LU .17, MT .18, NL .21, PL .23, PT .23, RO .21, SK .23, SI .22, ES .21, SE .25, plus GB .20, NO .25, CH .081, AU .10, NZ .15. Profit after VAT = price ÷ (1 + rate) − cost − fees, with fees taken from the margin.
- [ ] **Step 4: Run them.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message "VAT rates and margin after VAT".

### Task 2: Verdict rules

**Files:**
- Create: `convex/lib/verdictRules.ts`
- Test: `convex/lib/verdictRules.test.ts`

**Interfaces:**
- Consumes: `Margin` (lib/researchReport), `withVat` and `vatRate` (Task 1), `bigBrandIn` (lib/productMatch).
- Produces:
  - `type SignalKey = "ads" | "supplier" | "adspy" | "tiktok" | "ownStore"`
  - `type RuleInput = { margin: Margin | null; priceAssumed: boolean; vatRate: number | null; ads: { advertisers: number; longestDays: number }; supplierOrders?: number; adspyDemandOk: boolean | null; tiktokUnits?: number; ownOrders?: number; brandText: string; shippingDays?: number }`
  - `type Rules = { signals: { key: SignalKey; seen: boolean; detail: string }[]; blockers: string[]; ceiling: ResearchCall; costKnown: boolean; breakEven?: number; afterVat: boolean; cappedBy?: string }`
  - `evaluateRules(i: RuleInput): Rules`
  - `finalCall(ai: ResearchCall, aiBlocker: boolean, rules: Rules): { call: ResearchCall; cappedBy?: string }`
  - `whyLine(r: Rules, money: (usd: number) => string): string`
  - `RULES_VERSION = 2`
  - `ResearchCall` is the existing `"test" | "research" | "skip"`.

- [ ] **Step 1: Write the failing tests** with a `base()` RuleInput:
  - margin `marginMath(30, 8)`, priceAssumed false, vatRate null
  - ads `{ advertisers: 2, longestDays: 30 }`, supplierOrders 1000
  - adspyDemandOk null, brandText "Cat brush"

  Tests:
  - `signal thresholds`:
    - base → ads and supplier seen, ceiling "test"
    - longestDays 29 → ads not seen, ceiling "research", `cappedBy` contains "1 of 5 demand signals"
    - supplierOrders 999 → supplier not seen
    - `tiktokUnits: 1000` counts; `ownOrders: 3` counts and `ownOrders: 2` doesn't
    - `adspyDemandOk: true` counts
  - `margin blocker on a seen price`: margin `marginMath(12, 2.5)` (profit ≈ 8.85) → no blocker. With vatRate 0.25 → after-VAT profit ≈ 6.45 → blockers contain "Break-even ad cost under $8 after VAT", ceiling "skip".
  - `assumed price never skips` (Review Focus 1): the same low margin with `priceAssumed: true` → blockers empty, ceiling "research", cappedBy "price is a category estimate".
  - `unknown cost`: margin null → ceiling "research", cappedBy "supplier cost unknown".
  - `brand`: brandText "Stanley Quencher tumbler" → a blocker contains "Stanley", ceiling "skip".
  - `shipping`: `shippingDays: 16` → skip; `15` → no blocker; undefined → no blocker.
  - `finalCall` (Review Focus 4):
    - `finalCall("test", false, ceiling research)` → research, with cappedBy
    - `finalCall("skip", false, ceiling test)` → skip, no cappedBy
    - `finalCall("test", true, ceiling test)` → skip
  - `whyLine`: base with `money = (n) => "$" + n.toFixed(0)` → "2 of 5 demand signals · cost known · break-even $21" (profit 20.83). With vatRate 0.25 it ends "after VAT".
- [ ] **Step 2: Run them.** `npx vitest run convex/lib/verdictRules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `convex/lib/verdictRules.ts`** per the Global Constraints.
  - Blocker texts: "Break-even ad cost under $8" (+ " after VAT"), "Famous brand: <Brand>", "Shipping over 15 days".
  - `cappedBy` texts, with the first that applies used: "<n> of 5 demand signals", "supplier cost unknown", "price is a category estimate". In `finalCall`, `cappedBy` is set only when the ceiling lowered the AI's call.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** with the message "Verdict rules: demand signals, blockers and a ceiling".

### Task 3: Rules in the research verdict (backend)

**Files:**
- Modify: `convex/researchReports.ts` (`evidence`, `save`)
- Modify: `convex/lib/researchReport.ts` (`ResearchEvidence`, `researchEvidence`, `RESEARCH_SYSTEM`)
- Modify: `convex/ai.ts` (`researchProduct`)
- Modify: `convex/schema.ts` (researchReports: `rules: v.optional(v.any())`, `rulesVersion: v.optional(v.number())`, `aiCall: v.optional(v.string())`)
- Test: `convex/researchVerdict.test.ts`

**Interfaces:**
- Consumes: `evaluateRules`, `finalCall`, `RULES_VERSION` (Task 2); `vatRate`, `withVat` (Task 1).
- Produces:
  - `evidence` returns `{ …, ruleInput: Omit<RuleInput, "ownOrders">, vat?: { rate: number; country: string } }`
  - Saved report rows hold `report.call` (final), `aiCall`, `rules`, `rulesVersion: 2`
  - `researchProduct` returns the report with the final call
  - Task 4 adds `ownOrders` to the RuleInput inside `researchProduct`

- [ ] **Step 1: Extend `researchVerdict.test.ts`.** Add two tests, reusing the existing fetch stub style:
  - `caps the AI's test when the cost is unknown`: a product with 2 signals (ads: 2 advertisers, longest 30 days; a supplier match with `orders: 1000`) and no `cost`. The AI answers `call: "test"` → saved `report.call === "research"`, `aiCall === "test"`, `rules.cappedBy === "supplier cost unknown"`, `rulesVersion === 2`.
  - `skips a famous brand and tells the AI`: product title "Stanley Quencher 40oz" → `report.call === "skip"`, and the captured prompt contains "HARD BLOCKER: Famous brand: Stanley".
- [ ] **Step 2: Run them.** `npx vitest run convex/researchVerdict.test.ts`. Expected: the 2 new tests FAIL; the existing ones pass.
- [ ] **Step 3: Implement.**
  - **`evidence`:** build the `ruleInput`:
    - `priceAssumed = !p.price || p.priceSource === "estimated_market"`
    - `adspyDemandOk = quick.checks.find(c => c.key === "demand")?.ok ?? null`
    - `tiktokUnits` only when `p.source === "tiktok_shop"`
    - `brandText = p.title + " " + p.description`
    - `vatRate(user.targetCountry)`
  - **`researchEvidence`:** add a "RULES (decided by code, explain them, don't change them)" block: the signals seen and not seen, each blocker as "HARD BLOCKER: …", "Highest verdict allowed: …", and the after-VAT line when the rate isn't null ("Profit after <country> VAT <rate>%: $x").
  - **`RESEARCH_SYSTEM`:** one sentence saying the verdict may not be higher than the allowed one.
  - **`researchProduct`:** after `cleanReport`, run `evaluateRules` and `finalCall(report.call, report.risks.some(r => r.blocker), rules)`. Save `{ ...report, call: final.call }`, `aiCall`, `rules` (with `cappedBy`) and `rulesVersion`.
- [ ] **Step 4: Run them.** Run the same file, then `npx vitest run convex/researchVerdict.test.ts convex/launch.test.ts`. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Research verdict: code sets the ceiling, blockers mean skip, VAT line for the AI".

### Task 4: Own-store orders

**Files:**
- Modify: `convex/lib/shopifyOAuth.ts` (add `read_orders` to `SHOPIFY_SCOPES`; add `missingOrderScope`)
- Modify: `shopify.app.toml` (scopes)
- Modify: `convex/schema.ts` (launches: `ownOrders30d?: number`, `ownOrdersAt?: string`, `ownOrdersCapped?: boolean`)
- Create: `convex/lib/ownOrders.ts` (pure); `convex/ownOrders.ts` (internalAction + internal query/mutation)
- Modify: `convex/ai.ts` (`researchProduct` calls it), `convex/_generated/api.d.ts` (add the `ownOrders` module by hand, per CLAUDE.md)
- Test: `convex/lib/ownOrders.test.ts`, `convex/ownOrders.test.ts`

**Interfaces:**
- Consumes: `adminGql`, `NoAccess` (lib/shopifyAdmin), `decryptToken` (lib/shopifyOAuth).
- Produces:
  - `missingOrderScope(granted?: string): boolean` returns true only when `granted` is defined and lacks `read_orders`
  - `countOrdersWith(nodes: { lineItems: { nodes: { product: { id: string } | null }[] } }[], productGid: string): number`
  - `internal.ownOrders.forProduct({ userId, productId }) → { orders?: number; capped?: boolean; reason?: "no_launch" | "no_scope" | "pasted_token" | "error" }`
  - `researchProduct` passes `orders` as `ownOrders` to the rules, and `reason` to the saved report as `ownStore: { orders?, capped?, reason? }`

- [ ] **Step 1: Write the failing tests.**
  - **Pure:**
    - `countOrdersWith`: 3 orders, 2 of which contain `gid://shopify/Product/1` (one twice), returns 2
    - `missingOrderScope("write_products")` is true; `missingOrderScope("write_products,read_orders")` is false; `missingOrderScope(undefined)` is false
  - **Convex, with fetch stubbed:**
    - `counts orders of the launched product`: a user, an oauth connection with `read_orders`, and a published launch with `shopifyProductId: "gid://shopify/Product/1"` on the same shop. One page with 4 orders, 3 containing the product → `{ orders: 3 }`, and the launch row gets `ownOrders30d: 3`.
    - `uses the cache under 12 hours`: `ownOrdersAt` is 1 hour ago → no fetch call, the cached number is returned.
    - `scope missing`: connection scopes without `read_orders` → `{ reason: "no_scope" }`, no fetch.
    - `different shop` (Review Focus 3): the launch's `shopDomain` differs from the connection's → `{ reason: "no_launch" }`, no fetch.
    - `caps at 1000` (Review Focus 5): pages of 250 with `hasNextPage` always true → it stops after 4 pages, `capped: true`.
    - `Shopify error`: fetch returns 500 → `{ reason: "error" }`.
- [ ] **Step 2: Run them.** `npx vitest run convex/lib/ownOrders.test.ts convex/ownOrders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Query: `orders(first: 250, after: $after, query: "created_at:>=<ISO now−30d>") { nodes { lineItems(first: 50) { nodes { product { id } } } } pageInfo { hasNextPage endCursor } }`.
  - A pasted-token connection (`via` not "oauth") is still tried. Shopify refusing it (NoAccess) returns `"pasted_token"`.
  - Launch lookup: `launches.by_user_product`, newest `status === "published"` with a `shopifyProductId` and `shopDomain === connection.shopDomain`.
  - In `researchProduct`, call it before `evaluateRules`. Any thrown error becomes `{ reason: "error" }`, and the verdict still runs.
- [ ] **Step 4: Run them.** Run the same tests, then `npx vitest run convex/researchVerdict.test.ts`. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Own-store orders for launched products count as a demand signal".

### Task 5: Verdict card and Settings prompt (UI)

**Files:**
- Modify: `src/pages/dashboard/_components/ai/ResearchVerdictCard.tsx`
- Modify: the Settings → Shopify connection component (find it with `grep -rn "missingStoreScopes" src`; it is the file that shows the store's reconnect prompt)
- Modify: `convex/researchReports.ts` `latest` (no change needed if the row already carries `rules` and `ownStore`), and `api.currency.mine` (existing)
- Test: `src/pages/dashboard/_components/ai/ResearchVerdictCard.test.tsx`

**Interfaces:**
- Consumes: the saved report row (`rules`, `rulesVersion`, `aiCall`, `ownStore`, `margin`); `whyLine` (Task 2); `withVat`, `vatRate` (Task 1); `formatMoney` and `api.currency.mine`; `missingOrderScope` (Task 4).

- [ ] **Step 1: Write the failing component test** (jsdom, mocking `convex/react`'s `useQuery` to return a saved row):
  - `rulesVersion: 2`, rules with 2 signals seen, vat DK, currency DKK at rate 6.93 → the text contains "Why this verdict", "2 of 5 demand signals" and "after VAT", and amounts end in "kr".
  - `rules.cappedBy: "supplier cost unknown"` with `aiCall: "test"` → it contains "Capped at research more: supplier cost unknown".
  - A row without `rulesVersion` → it contains "Made with older rules · Refresh".
  - `ownStore.reason: "no_scope"` → it contains "Reconnect your store to count your own sales"; with `"pasted_token"` it contains "Add read_orders to your app's access scopes".
  - `ownStore.orders: 7` → it contains "Your store: 7 orders in 30 days".
  - A user without `targetCountry` → it contains "Set the country you sell to".
- [ ] **Step 2: Run it.** `npx vitest run src/pages/dashboard/_components/ai/ResearchVerdictCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Margin rows are shown in the display currency via `formatMoney`, with a note "1 $ = <rate> <code>, rate of <date>". Add the after-VAT row when a rate applies.
  - "Refresh" re-runs `api.ai.researchProduct`.
  - Reconnect uses the same reconnect action as the existing store-scope prompt.
  - Settings → Shopify shows the reconnect line when `missingOrderScope(store.scopes)` is true.
- [ ] **Step 4: Run it**, plus `pnpm build`. Expected: the test passes and the build succeeds.
- [ ] **Step 5: Commit** with the message "Verdict card: why this verdict, VAT in your currency, own-store sales".

### Task 6: Full check and handoff

- [ ] **Step 1:** Run `pnpm test > .superpowers/full-test.log 2>&1; tail -20 .superpowers/full-test.log`. Expected: all files pass. A launch test that fails only under load is a known flaky case: re-run it alone, and it must pass.
- [ ] **Step 2:** Run `npx tsc --noEmit -p convex`, `pnpm build`, and `npx eslint` on every changed file. Expected: clean.
- [ ] **Step 3:** Push the branch and open a PR. The PR body lists the user's two Dev Dashboard steps (protected customer data level 1 for orders; release the app version with `read_orders`). Merging deploys, so the user merges it.
