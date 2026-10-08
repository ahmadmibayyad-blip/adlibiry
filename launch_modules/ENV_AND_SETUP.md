# Launch feature — env vars and setup

Everything needed to run the Launch feature (one-click Shopify publishing) and to
test it end-to-end on a Shopify development store.

Integrated code (for reference):

| Area | Where |
|---|---|
| Schema | `convex/schema.ts` — `shopifyConnections` (extended), `shopifyOAuthStates`, `launches`, `launchUsage` |
| Shopify app (OAuth, webhooks, token encryption) | `convex/shopifyApp.ts` + `convex/lib/shopifyOAuth.ts` |
| HTTP routes | `convex/http.ts` — `GET /shopify/callback`, `POST /shopify/webhooks` |
| Page generation + quota | `convex/launch.ts` (incl. `myQuota`), `convex/launchRun.ts`, `convex/lib/launchCopy.ts` |
| Frontend | `src/pages/dashboard/products/_components/LaunchDialog.tsx` (button), `src/pages/dashboard/launches/page.tsx` (dashboard), routes `/dashboard/launch` + `/dashboard/launch/shopify-callback` |

---

## 1. Convex environment variables

Set in production with `npx convex env set NAME value` (add `--dev` for the dev
deployment, or put them in `.env.local` when running `npx convex dev`).

| Variable | What | How to get it |
|---|---|---|
| `SHOPIFY_API_KEY` | The app's client ID | Shopify Dev Dashboard → your app → API credentials |
| `SHOPIFY_API_SECRET` | The app's client secret | same page |
| `SHOPIFY_TOKEN_KEY` | **32 random bytes, base64** — encrypts store access tokens at rest (AES-GCM, `enc:v1:` prefix) | `node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"` |
| `CONVEX_SITE_URL` | Your deployment's site URL, e.g. `https://wonderful-animal-123.convex.site`. Used to build the OAuth redirect (`/shopify/callback`) and as the webhook target. | Convex Dashboard → deployment → Settings |
| `SITE_URL` | Frontend origin, e.g. `https://adspypro.net`. The OAuth flow returns the browser to `${SITE_URL}/dashboard/launch/shopify-callback`. | you own it (falls back to `https://adspypro.net`) |
| `ANTHROPIC_API_KEY` | Powers the page/ad-kit generation | Anthropic console |
| `LAUNCH_MONTHLY_PRO` | Optional. Published pages per month for paid non-agency plans. | default `10` |

**Token-key rotation:** changing `SHOPIFY_TOKEN_KEY` makes every stored
`enc:v1:` token unreadable. Only rotate together with a re-connect of all stores.

**Token storage:** app installs are encrypted before they are persisted; plain
`shpat_…` tokens from the old paste-a-token flow are stored as-is until the
merchant reconnects through the app. Tokens are only used server-side
(`convex/launchRun.ts` decrypts just before calling Shopify) and are deleted on
`app/uninstalled` / `shop/redact`.

## 2. Shopify Partner Dashboard steps

1. **Partner account:** partners.shopify.com → sign in → **Apps → Create app**.
   Choose **public app** (not custom). Suggested name: *AdSpy Pro – Launch*.
2. **Configuration:**
   - **App URL:** `https://adspypro.net/dashboard/launch` (the embedded admin
     page is a Phase-2 addition; see the review checklist).
   - **Allowed redirection URL(s):** `https://<deployment>.convex.site/shopify/callback`
     (must match `CONVEX_SITE_URL`).
   - **API access scopes:** `write_products, read_products, write_publications, read_publications`
     (this is `SHOPIFY_SCOPES` in `convex/lib/shopifyOAuth.ts`). If v1 ships
     draft-only, drop the two `publications` scopes and the auto-live publish.
3. **Webhooks** (same dashboard section): subscribe these topics to
   `https://<deployment>.convex.site/shopify/webhooks`:
   - `app/uninstalled` — deletes the store's token immediately
   - `customers/data_request`, `customers/redact`, `shop/redact` — Shopify's
     mandatory GDPR topics; we keep no customer data, and `shop/redact` removes
     the store. Every webhook call is HMAC-verified (bad signature → 401).
4. **API credentials:** copy the client ID/secret into the Convex env vars above.
5. **Dev store:** Partner Dashboard → **Stores → Add store → Create development
   store** (use a realistic country/catalog so locales and currency are real).

## 3. End-to-end test on a development store

Prereqs: env vars from §1 are set on the deployment the frontend points at
(`VITE_CONVEX_URL` in `.env.local`), and the app has the routes from the table above.

### Path A — OAuth install (the real flow)

1. Dev Dashboard → your app → **Test on development store** → pick the dev store.
2. In AdSpy Pro: **Launch** (sidebar) or any product → **Launch** → connect card,
   enter `your-store.myshopify.com` → **Connect with Shopify** → approve.
3. Shopify returns to `/dashboard/launch/shopify-callback?shopify=connected` →
   toast confirms; the header shows the store chip.
4. Open any non-big-brand product → **Launch** → keep the suggested price
   (cost × ~2.8 with margin shown) → **Write and launch**.
5. Wait for *"…is in your store as a draft"* → **Open in Shopify**: check the
   description HTML (hook, benefits, how-it-works, FAQ, shipping), price,
   compare-at/cost, images, SEO fields, `adspy.page` metafield, and the ad kit
   in the dialog.
6. Re-launch with *Publish it live now*: product appears on the Online Store at
   `https://<store>/products/<handle>`.
7. Uninstall the app in the store → the connection disappears (webhook).

### Path B — custom-app token (fallback; needed only where custom apps still exist)

Shopify ended new custom-app creation for merchants in 2026, so Path A is the
default. Where a store still has one: store admin → **Settings → Apps and sales
channels → Develop apps** → create → scopes `write_products` → install → copy
the `shpat_…` token → in AdSpy Pro use the product page's **Add to Shopify →
Connect store** (token paste). Launches then use that token; the paste flow is
retired once the public app is approved.

### Quota checks (same session)

- Free/starter plan → Launch button shows the Pro upsell.
- Pro trial → 2 published pages total; third attempt is refused with the reason.
- Pro (paid) → `LAUNCH_MONTHLY_PRO` per calendar month; the header chip counts
  down. Failed launches do not consume quota. Agency → unlimited.
