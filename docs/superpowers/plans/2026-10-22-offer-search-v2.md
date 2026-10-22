# Offer Search v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type each found store (Hero / Niche dropship / General / Brand-retailer), prove sourcing with an automatic AliExpress match, find more stores ("Find more", "Who else sells this"), and sort by what's scaling.

**Architecture:** Pure rules in `convex/lib/offerSearch.ts` (typing, phrases, short names, merge, sort); `convex/offerSearch.ts` reads the extra shop data, runs the picture matches and the "Find more" run; `StoreResults.tsx` shows types, sourcing, links and the button.

**Tech Stack:** Convex, React + Vite, vitest + convex-test, Apify (Ad Library scraper, `PICTURE_ACTOR`).

**Spec:** `docs/superpowers/specs/2026-10-22-offer-search-v2-design.md`

## Global Constraints

- Commands: `npx vitest run <files>`, `npx tsc --noEmit -p convex`, `npx tsc -b`, `npx eslint <files>`; commit as ahmadmibayyad-blip <ahmadmibayyad@gmail.com>.
- Still 150 ads a run (`MAX_ADS`), exact phrases and `adShowsOffer` unchanged; `STORES_KEPT` 40 per run, 80 after Find more.
- Sourcing: at most 15 stores a search, 5 at a time, each through `aliexpressImage.claimDay` (`pictureLimit()`).
- Type thresholds: on sale ≥ 0.6, ™ share ≥ 0.15, hero ≤ 15 products and ≤ 3 types, niche ≤ 80 and ≤ 8, points ≥ 2 (hero/niche), ≥ 3 (general).
- Copy, verbatim: "Hero store", "Niche dropship", "General store", "Brand/retailer"; filter labels "Likely dropshippers", "Hero stores", "Niche dropship", "General stores"; "Find more stores (+150 ads)", "Finding more stores…", "All phrases searched", "Who else sells this".
- No `Array.prototype.at()` in `convex/`.

## Review Focus

1. A store whose `/products.json` or home page doesn't answer (Middo: count 595, products.json empty) is still typed from what was read, never crashes — pinned in Task 1 (`storeType` with only `catalogue`).
2. Old saved searches (no `type` on `dropship`) still render and filter — pinned in Task 5.
3. The daily picture limit reached mid-search: remaining stores just get no sourcing, the search still finishes — pinned in Task 3.
4. Find more pressed twice, or on a custom-words search, or on someone else's search — refused — pinned in Task 4.
5. A product price in DKK/SEK vs supplier USD: markup uses `toUsd`, not raw numbers — pinned in Task 3.

---

### Task 1: Store type, phrases, short names, merge and sort (pure)

**Files:** Modify `convex/lib/offerSearch.ts`; Test `convex/lib/offerSearch.test.ts`

**Interfaces — Produces:**
- `FoundStore` gains `catalogue?: number; productTypes?: number; onSaleShare?: number; tmShare?: number; defaultVendor?: boolean; apps?: string[]`; `FoundProduct` gains `sourcing?: { price: number; url: string; title: string; markup: number }`.
- `type StoreType = "hero" | "niche" | "general" | "brand"`; `Dropship` becomes `{ score: number; likely: boolean; type: StoreType; reasons: string[] }`.
- `storeType(s: FoundStore): Dropship` (replaces `dropshipScore`; export `dropshipScore` as an alias for one release is not needed — update callers).
- `DROPSHIP_APPS: Set<string>` = "Loox", "Ali Reviews", "Parcel Panel", "Track123", "Trackpanda"; `SOURCING_APPS: Set<string>` = "DSers", "AutoDS", "CJ Dropshipping", "Zendrop", "Sell The Trend", "Spocket".
- `sourcingAppsIn(html: string): string[]` (regexes from the spec).
- `DEFAULT_VENDORS` and `isDefaultVendor(v: string): boolean`.
- `OFFERS[id].more: Record<Lang, string[]>` (up to 3, every offer × language); `morePhrases(offer: OfferId, country: string): string[]`.
- `shortProductName(title: string, brand?: string): string`.
- `mergeStores(a: FoundStore[], b: FoundStore[], max = 80): FoundStore[]` (adds ads/copies, merges offer counts, keeps a's fields, appends new hosts, cuts to max).
- `StoreFilter.type?: StoreType`; `filterStores` sort `"dropship"` = likely first, then type order hero < niche < general, then reach desc, then ads.

- [ ] **Step 1: Failing tests** (`describe("store types")` etc.):
```ts
const base = { advertisers: ["X"], ads: 3, copies: 3, oldestDays: 100, offers: [], productPaths: [], sample: [] };
it("types a hero store", () => {
  expect(storeType({ ...base, host: "moobalm.store", shopify: true, catalogue: 6, productTypes: 0, onSaleShare: 0.83, apps: ["Judge.me"] }))
    .toMatchObject({ type: "hero", likely: true, reasons: ["6 products", "0 types", "83% on sale"] });
});
it("types a niche dropship store", () => {
  expect(storeType({ ...base, host: "relivex.nl", shopify: true, catalogue: 47, productTypes: 4, onSaleShare: 0.74, tmShare: 0.62, apps: ["Loox", "Ali Reviews", "Parcel Panel"] }))
    .toMatchObject({ type: "niche", likely: true, reasons: ["47 products", "4 types", "74% on sale", "Loox, Ali Reviews, Parcel Panel", "™ titles"] });
});
it("types a general store", () => {
  expect(storeType({ ...base, host: "vahlery.de", shopify: true, catalogue: 224, productTypes: 10, onSaleShare: 0.81, offers: [{ label: "Limited time", count: 2 }], products: [{ handle: "h", url: "u", title: "t", price: 24, compareAt: 48 }] }))
    .toMatchObject({ type: "general", likely: true });
});
it("keeps brands and retailers out", () => {
  expect(storeType({ ...base, host: "gymshark.com", shopify: true, catalogue: 1018, productTypes: 53, onSaleShare: 0.33 })).toMatchObject({ type: "brand", likely: false });
  expect(storeType({ ...base, host: "etos.nl" })).toMatchObject({ type: "brand", likely: false });
  expect(storeType({ ...base, host: "nike.com", shopify: true, catalogue: 5 })).toMatchObject({ type: "brand", reasons: ["Big brand"] });
});
it("types from what was read", () => { // Middo: products.json empty, meta count only
  expect(storeType({ ...base, host: "middo.nl", shopify: true, catalogue: 595, apps: ["Parcel Panel", "DSers"], offers: [{ label: "Limited time", count: 4 }] }))
    .toMatchObject({ type: "general", likely: true });
});
it("counts a sourcing app double and a default vendor", () => {
  const s = storeType({ ...base, host: "rawresolve.com", shopify: true, catalogue: 9, productTypes: 0, onSaleShare: 0.2, defaultVendor: true, apps: ["DSers"] });
  expect(s).toMatchObject({ type: "hero", score: 3 });
  expect(s.reasons).toEqual(expect.arrayContaining(["DSers", "default vendor"]));
});
it("finds sourcing apps in page code", () => {
  expect(sourcingAppsIn('<script src="https://cdn.dsers.com/x.js"></script> sell-the-trend')).toEqual(["DSers", "Sell The Trend"]);
});
it("has more phrases for every offer and language", () => { for (const id of OFFER_IDS) for (const c of Object.values(OFFER_COUNTRIES)) expect(OFFERS[id].more[c.lang].length).toBeGreaterThan(0); expect(morePhrases("bxgy", "NL")).toEqual(["tijdelijk 1+1", "3 voor 2", "alleen vandaag 1+1"]); });
it("shortens a product title to a search", () => {
  expect(shortProductName("ReliveX™ Magnetische Inlegzolen | Verlies Gewicht bij ELKE STAP", "ReliveX")).toBe("Magnetische Inlegzolen");
  expect(shortProductName("Wijnkoeler – Geen Lauwe Wijn Meer")).toBe("Wijnkoeler");
  expect(shortProductName("Happy Brain - Premium nootropic supplement (1+1 gratis)", "HappySupps")).toBe("Happy Brain");
});
it("merges a second run's stores", () => { /* a.nl in both: ads 2+3=5; b.nl new appended; max respected */ });
it("sorts dropshippers by type then reach", () => { /* hero(reach 10) , niche(reach 99), brand(ads 50) → hero, niche, brand */ });
```
- [ ] **Step 2: Run** `npx vitest run convex/lib/offerSearch.test.ts` → FAIL.
- [ ] **Step 3: Implement** per Interfaces and spec §1/§3/§4. Reason order: "N products", "N types", "N% on sale", apps (dropship + sourcing, comma-joined), "™ titles", "default vendor", "Urgency ads", "−N%", "On AliExpress ×M" (when any product has `sourcing`). Points per spec; a sourcing match also +1.
- [ ] **Step 4: Run** → PASS; `npx eslint convex/lib/offerSearch.ts convex/lib/offerSearch.test.ts` clean.
- [ ] **Step 5: Commit** `feat(offer-search): store types, more phrases, short names, merge`.

### Task 2: Read the shop data for typing

**Files:** Modify `convex/offerSearch.ts` (`withShopData`, `finish`), Test `convex/offerSearch.test.ts`

**Interfaces — Consumes:** Task 1 fields and `storeType`, `sourcingAppsIn`, `isDefaultVendor`; `inspectHtml` from `lib/storeInspect.ts` (its `apps[].name`).

- [ ] **Step 1: Failing test** in the Danish search test: stub `https://pawtech.dk/meta.json` with `published_products_count: 7`, `/products.json?limit=250` with 7 products (types "Pet" ×7, 6 with compare-at > price, one title with ™, vendor "Mijn winkel"), home page HTML containing a Loox script (`https://loox.io/widget/...`). Expect store 0 `{ catalogue: 7, productTypes: 1, onSaleShare: 0.86, tmShare: 0.14, defaultVendor: true, apps: ["Loox"] }` and `dropship.type` `"hero"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: `withShopData` reads `published_products_count` (fallback products.json length), computes the shares from products.json, fetches `https://host/` once (6 s timeout) for `inspectHtml(html).apps` names ∩ `DROPSHIP_APPS` plus `sourcingAppsIn(html)`; `finish` uses `storeType` (rename from `dropshipScore`). **Step 4: Run** → PASS, tsc clean. **Step 5: Commit** `feat(offer-search): read catalogue, sale share, apps for store types`.

### Task 3: Automatic sourcing proof

**Files:** Modify `convex/offerSearch.ts`; Test `convex/offerSearch.test.ts`

**Interfaces — Produces:** `async function addSourcing(ctx: ActionCtx, stores: FoundStore[], token: string): Promise<FoundStore[]>` (internal helper); uses `internal.aliexpressImage.claimDay`, `internal.currency.allRates`, `fromPictureSearch(items, { price: usd, title })`, `toUsd`.

- [ ] **Step 1: Failing tests:** (a) "matches the hero product on AliExpress and shows the markup": Apify picture actor stub returns `[{ site: "aliexpress", title: "Dog seat cover", price: 9.5, currency: "USD", productUrl: "https://www.aliexpress.com/item/1.html" }]`; product price 299 DKK; rates stub/table → expect `products[0].sourcing` `{ price: 9.5, url: "https://www.aliexpress.com/item/1.html", markup: <299 DKK in USD ÷ 9.5, 1 decimal> }` and reason "On AliExpress ×N". (b) "stops at the daily picture limit": `PICTURE_LOOKUPS_PER_DAY=0` → no `sourcing`, search `done`. (c) only likely stores with a product image, at most 15.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** after typing in `finish` (and in Task 4's merge for new stores): cheapest match kept; markup = round(usd/price × 10)/10; then re-run `storeType` so the reason appears. **Step 4/5:** PASS, commit `feat(offer-search): automatic AliExpress sourcing proof`.

### Task 4: Find more

**Files:** Modify `convex/schema.ts` (`offerSearches.moreRunToken?: string`, `moreStatus?: string`, index `by_more_token`), `convex/offerSearch.ts`; Test `convex/offerSearch.test.ts`

**Interfaces — Produces:** `offerSearch.findMore` action `{ id: Id<"offerSearches"> }` → `{ ok: true }`; `get` returns `moreStatus`. `finish(runToken)`: if no running row has `runToken`, rows with `moreRunToken` = token and `moreStatus: "running"` are merged with `mergeStores` (new hosts get shop data, type, sourcing) and set `moreStatus: "done"`; `finished` with an error on a more token sets `moreStatus: "failed"`; `runByToken` also finds more tokens.

- [ ] **Step 1: Failing tests:** "finds more stores once, with other phrases": after the Danish search is done, `findMore` starts a run whose URLs are `morePhrases("bxgy","DK")` exact phrases, counts as a search (`recent.used` 2), `moreStatus` "running"; webhook with new ads for `newstore.dk` and one more for `pawtech.dk` → stores include newstore.dk, pawtech.dk ads increased, `moreStatus` "done"; a second `findMore` → `{ code: "DONE" }`. "refuses custom-word searches and other users' searches" → `BAD_REQUEST` / `NOT_FOUND`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** reusing `start`'s budget/limit checks (extract a helper `checkCanSearch(ctx, userId)` if needed) and `internal.apify.startTrackedRun` with `trigger: "offer"`. **Step 4/5:** PASS, commit `feat(offer-search): Find more stores`.

### Task 5: Results UI

**Files:** Modify `src/pages/dashboard/offer-search/_components/StoreResults.tsx`, `src/pages/dashboard/offer-search/page.tsx`; Test `StoreResults.test.tsx` (+ page test if needed), `CLAUDE.md`

**Interfaces — Consumes:** `Dropship.type`, `FoundProduct.sourcing`, `shortProductName`, `api.offerSearch.findMore`, `get().moreStatus`.

- [ ] **Step 1: Failing tests:** type badges ("Hero store", "Niche dropship", "General store"); filter default "Likely dropshippers" and options "Hero stores" etc. (test via the "Show all N stores" link and a pre-set type through props is fine); AliExpress line "AliExpress $9.50 · ×4.2" linking to the match; "Who else sells this" link to `/dashboard/offer-search?country=DK&words=Magnetische%20Inlegzolen`; old stores without `type` still listed; page: "Find more stores (+150 ads)" button calls `findMore`, "Finding more stores…" while `moreStatus` running, "All phrases searched" when done.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; page reads `?country=&words=` to prefill "My own words" and start the search on click. CLAUDE.md Offer Search paragraph updated. **Step 4/5:** PASS, eslint/tsc clean, commit `feat(offer-search): store types, sourcing, Find more and Who else in the results`.

### Task 6: Whole-branch check and PR

- [ ] Full suite `npx vitest run --maxWorkers=4` (known local-only failures: adEmbeddings/sharp, renderApi/chromium); `git merge-tree` with main clean; push, PR, CI; final fresh review.
