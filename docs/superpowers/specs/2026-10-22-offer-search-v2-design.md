# Offer Search v2: store types, sourcing proof, more stores

Date: 2026-10-22. Status: approved in chat ("all 4"), spec for review.

## Why

Offer Search finds stores running an offer, and since PR #275 it scores "likely dropshippers". The user wants it to find
dropshippers reliably and find more of them. A probe of 36 stores (26 from real NL results, plus Gymshark, Allbirds,
Kylie, Mous, Skims, Etos, Hunkemöller, VEVOR) showed what separates them:

- Delivery time and "China" in policies don't: most NL dropshippers deliver in 1–5 days from EU agents' warehouses,
  and brands mention China too.
- What does: a small catalogue with few product types, most products "on sale" (60–100% vs ~33% for brands),
  dropship apps (Loox, Ali Reviews, Parcel Panel/Track123/Trackpanda, DSers/AutoDS/CJ/Zendrop/Sell The Trend),
  "™" in product titles, and default leftovers (vendor "Mijn winkel"/"My Store").
- The strongest proof is product level: the same product on AliExpress for a fraction of the price.

## What the user agreed (all four)

1. **Store type** instead of yes/no: Hero store, Niche dropship, General store, Brand/retailer, with evidence.
2. **Sourcing proof**: the hero product of likely dropshippers is matched on AliExpress automatically; supplier
   price and markup shown.
3. **More stores**: "Find more" (150 more ads with other dropshipper phrases) and "Who else sells this" (a new
   search for a hero product's name).
4. **Sorted by what's scaling**: dropshippers first, by EU reach, then ads.

Search size stays 150 ads per run; exact phrases and the offer filter (PR #275) stay.

## 1. Store type

Read per Shopify store in `withShopData` (already fetching `/meta.json`, `/products.json?limit=250`):

- `meta.published_products_count` → `catalogue` (true size, not capped at 250).
- From products.json: `productTypes` (distinct non-empty `product_type`), `onSaleShare` (share whose first variant
  has compare-at > price), `tmShare` (share of titles with ™ or ®), `defaultVendor` (a vendor that is a Shopify
  default name: "Mijn winkel", "My Store", "Mein Shop", "Ma boutique", "Mi tienda", "Min butik", "Min butikk").
- Home page HTML (one more fetch): `inspectHtml` from `lib/storeInspect.ts` for apps, plus a regex for sourcing apps
  it doesn't know (`dsers`, `autods`, `cjdropshipping`, `zendrop`, `sellthetrend|sell-the-trend`, `spocket`).
  Dropship apps = Loox, Ali Reviews, Parcel Panel, Track123, Trackpanda, and those sourcing apps.

`storeType(s)` in `lib/offerSearch.ts` (pure, replaces `dropshipScore`'s yes/no; `dropship` keeps `score`,
`likely`, `reasons` and gains `type`):

- Big brand (`bigBrandIn`) or not Shopify → **Brand/retailer**.
- Dropship evidence points: `onSaleShare ≥ 0.6` (+1), any dropship app (+1, +2 for a sourcing app),
  `tmShare ≥ 0.15` (+1), `defaultVendor` (+1), urgency in its ads (+1), a hero product with ≥30% crossed-out
  discount (+1).
- `catalogue ≤ 15` and `productTypes ≤ 3` → **Hero store** if points ≥ 2.
- `catalogue ≤ 80` and `productTypes ≤ 8` → **Niche dropship** if points ≥ 2.
- Otherwise, with points ≥ 3 → **General store**.
- Anything else → **Brand/retailer**.
- `likely` = type is Hero, Niche or General. `score` = points (for sorting within a type).
- Reasons, in order, e.g. "9 products · 2 types · 89% on sale · Loox, Parcel Panel · ™ titles · default vendor".

## 2. Sourcing proof

After stores are typed, for up to 15 likely stores with a hero product photo (most ads first): run the AliExpress
picture search (`PICTURE_ACTOR`, `fromPictureSearch` with the product's price and title) on the hero product image,
5 at a time, each counted by `aliexpressImage.claimDay` (stops when the daily picture limit is reached). Keep the
cheapest match: `sourcing: { price (USD), url, title, markup }` on that product, where markup = product price in
USD (`toUsd` with `internal.currency.allRates`) ÷ supplier price, rounded to one decimal. No match → no field.
Cost ~$0.006 each, ≤ ~$0.09 per search. Matches add the reason "On AliExpress ×N".

## 3. More stores

- **Find more** (`offerSearch.findMore({ id })`, user's own done search, once per search): runs 150 more ads with
  the offer's second phrase set (`OFFERS[offer].more[lang]`, up to 3 phrases each), same budget and daily-search
  checks as `start` (counts as one search). The row gets `moreRunToken`, `moreStatus` (running | done | failed).
  `finish` on that token merges: new stores appended, stores already found get their ads/copies/offers added,
  the list kept to 80 stores; typing and sourcing run for the new stores only. Custom-word searches have no
  "Find more".
- **Who else sells this**: a link on a hero product: starts a new Offer Search with "My own words" = the product's
  short name (`shortProductName(title)`: text before "|", "-", "–" or ":", ™/® and the store's brand removed, first
  4 words), same country, no offer. Reuses the existing custom-words path.

Second phrase sets (`more`), e.g. bxgy nl: "tijdelijk 1+1", "3 voor 2", "alleen vandaag 1+1"; every offer and
language gets one.

## 4. Sorting

`sort: "dropship"` (default when stores are typed): likely first, then Hero, Niche, General; within, EU reach desc,
then ads. Filter options: "Likely dropshippers" (default), "Hero stores", "Niche dropship", "General stores",
"Shopify only", "Any".

## UI (StoreResults, offer-search page)

- Card badge: the type ("Hero store" / "Niche dropship" / "General store"); reasons line as now.
- Hero product row: "AliExpress $6.40 · ×6.2" linking to the match; "Who else sells this" link.
- Under results: "Find more stores (+150 ads)" button; "Finding more stores…" while running; "All phrases searched"
  after.

## Tests

- `lib/offerSearch.test.ts`: `storeType` for each type with the probe's real shapes (MooBalm-like hero, ReliveX-like
  niche, Vahlery-like general, Gymshark-like brand, non-Shopify retailer), reasons; `shortProductName`; `more` phrases
  exist for every offer and language; sort order; merge of found-more stores.
- `offerSearch.test.ts`: typing reads meta count/types/sale share/apps; sourcing adds markup and respects the picture
  limit; `findMore` runs once, merges, counts as a search; custom searches refuse it.
- `StoreResults.test.tsx`: type badges, filters, AliExpress line, Who else sells this link, Find more button states.

## Not in this version

Store age from Wayback, CJ sourcing matches, TikTok ads, automatic "Who else" for every product.
