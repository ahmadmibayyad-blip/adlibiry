"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import * as z from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { LAUNCH_SYSTEM, cleanCopy, launchFacts, launchProductInput, type LaunchCopy } from "./lib/launchCopy";
import { decryptToken } from "./lib/shopifyOAuth";
import { SHOPIFY_API_VERSION } from "./lib/shopifyExport";
import {
  STORE_ICONS,
  STORE_SYSTEM,
  TRUST_ICONS,
  cleanStore,
  storeFacts,
  storeMenus,
  storePages,
  themeSecret,
  themeSignature,
  STORE_MENU_HANDLES,
  type StoreCopy,
  type StoreFacts,
  type StorePageKey,
} from "./lib/storeKit";
import { STORE_STYLES, isStoreStyle } from "./lib/storeStyles";

// The Launch job (convex/launch.ts start): Claude writes the page and ad kit
// from the product's facts and its winning ads, the claim rules clean it, and
// it's created in the user's store with productSet (and put on the Online
// Store when published as active). A Full store launch also gets the store's
// copy, its pages and menus, and our storefront theme (served as a zip by
// storeThemeHttp.ts) installed unpublished. Progress and errors land on the launch row.

const MODEL = "claude-opus-5-5";

// No min/max in the schema (structured output); lengths are enforced in cleanCopy / cleanStore.
const CopySchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  benefits: z.array(z.string()),
  hook: z.string(),
  howItWorks: z.array(z.string()),
  whatsIncluded: z.array(z.string()),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  shippingReturns: z.string(),
  seo: z.object({ title: z.string(), description: z.string() }),
  adKit: z.array(z.object({ angle: z.string(), hook: z.string(), primaryText: z.string(), headline: z.string() })),
});

const titled = z.object({ title: z.string(), text: z.string() });
const StoreSchema = z.object({
  announcement: z.string(),
  hero: z.object({ eyebrow: z.string(), heading: z.string(), text: z.string(), button: z.string(), points: z.array(z.string()) }),
  trust: z.array(z.object({ icon: z.enum(TRUST_ICONS), text: z.string() })),
  benefits: z.object({ heading: z.string(), text: z.string(), items: z.array(z.object({ icon: z.enum(STORE_ICONS), title: z.string(), text: z.string() })) }),
  steps: z.object({ heading: z.string(), items: z.array(titled) }),
  story: z.object({ eyebrow: z.string(), heading: z.string(), paragraphs: z.array(z.string()), button: z.string() }),
  faq: z.object({ heading: z.string(), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
  newsletter: z.object({ heading: z.string(), text: z.string() }),
  footerText: z.string(),
  productTrust: z.object({ shipping: z.string(), returns: z.string(), payment: z.string() }),
  pages: z.object({
    about: z.object({ title: z.string(), paragraphs: z.array(z.string()) }),
    shipping: z.object({ title: z.string(), paragraphs: z.array(z.string()) }),
    faq: z.object({ title: z.string() }),
    contact: z.object({ title: z.string(), intro: z.string() }),
  }),
  menu: z.object({ home: z.string(), shop: z.string(), about: z.string(), faq: z.string(), contact: z.string(), shipping: z.string(), search: z.string() }),
});
const FullSchema = z.object({ product: CopySchema, store: StoreSchema });

const STORE_GUIDE =
  "Also write `store`: announcement (one short line, e.g. the delivery time or free shipping if given), hero (eyebrow 2–4 words, " +
  "heading max 8 words, text 1–2 sentences, button 2–3 words, 3 short points), trust (3–4 items: delivery, secure checkout, returns, " +
  "support), benefits (heading, one-sentence intro, 3–4 items with an icon each), steps (3 items: how to use it), story (why we " +
  "picked this product, 2 short paragraphs, button to the About page), faq (6–8 buyer questions incl. delivery and returns, answered " +
  "only from the facts), newsletter (heading + one line; no discount unless given), footerText (one sentence), productTrust (three " +
  "short lines under the buy button: delivery, returns, payment), pages (About: 3–4 paragraphs; Shipping & returns: 4–6 paragraphs " +
  "from the store facts only, telling customers to contact support to start a return; FAQ page title; Contact title + one-line intro), " +
  "and menu labels.";

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] | string };

async function shopify(shop: string, token: string, query: string, variables?: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // Shopify rate limit or hiccup: wait and retry
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Gql;
    if (res.status === 401 || res.status === 403) throw new Error("Shopify refused access. Reconnect your store in Settings → Shopify.");
    if (!res.ok || body.errors) {
      const msg = typeof body.errors === "string" ? body.errors : (body.errors ?? []).map((e) => e.message).join("; ");
      if (/access denied|required access/i.test(msg)) {
        throw new Error(`Your Shopify connection is missing a permission (${msg.slice(0, 160)}). Reconnect your store in Settings → Shopify and approve the permissions.`);
      }
      throw new Error(`Shopify: ${msg || `HTTP ${res.status}`}`.slice(0, 300));
    }
    return body.data ?? {};
  }
  throw new Error("Shopify is busy right now. Please try again in a minute.");
}

type UserError = { field?: string[] | null; message: string };
const userErrors = (errs: UserError[] | undefined) => (errs ?? []).map((e) => e.message).join("; ");

const PRODUCT_SET = `mutation Launch($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle onlineStorePreviewUrl }
    userErrors { field message }
  }
}`;

const PAGE_CREATE = `mutation PageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { field message } }
}`;
const PAGE_UPDATE = `mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
}`;
const MENUS = `{ menus(first: 50) { nodes { id handle } } }`;
const MENU_CREATE = `mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message } }
}`;
const MENU_UPDATE = `mutation MenuUpdate($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message } }
}`;
const THEME_CREATE = `mutation ThemeCreate($source: URL!, $name: String!) {
  themeCreate(source: $source, name: $name, role: UNPUBLISHED) { theme { id processing } userErrors { field message } }
}`;
const THEME_STATUS = `query Theme($id: ID!) { theme(id: $id) { id processing processingFailed } }`;
const THEME_PUBLISH = `mutation ThemePublish($id: ID!) { themePublish(id: $id) { theme { id role } userErrors { field message } } }`;

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

export const run = internalAction({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "failed", error: error.slice(0, 400) });
    };
    const c = await ctx.runQuery(internal.launch.context, { launchId: args.launchId });
    if (!c) return;
    if (!c.product || !c.store) return fail("The product or the connected store is gone.");
    const { launch, product, store, ads, rate } = c;
    const fullStore = launch.mode === "store" && isStoreStyle(launch.style);
    const facts = launch.facts as StoreFacts | undefined;

    // 1. Write the page and ad kit (and for a full store, the rest of the store).
    let copy: LaunchCopy;
    let storeCopy: StoreCopy | undefined;
    try {
      if (!process.env.ANTHROPIC_API_KEY) return fail("The AI isn't set up yet (missing ANTHROPIC_API_KEY).");
      const productFacts = launchFacts(product, ads, { language: launch.language, tone: launch.tone, price: launch.price });
      if (fullStore && facts) {
        const message = await claudeClient().messages.parse({
          model: MODEL,
          max_tokens: 16000,
          system: `${LAUNCH_SYSTEM}\n\n${STORE_SYSTEM}`,
          messages: [
            {
              role: "user",
              content: `${productFacts}\nStore name: ${launch.brandName}\nStore style: ${STORE_STYLES[launch.style as keyof typeof STORE_STYLES].name} (${STORE_STYLES[launch.style as keyof typeof STORE_STYLES].description})\n${storeFacts(facts)}\n\nWrite \`product\` (the product page and ad kit) as usual. ${STORE_GUIDE}`,
            },
          ],
          output_config: { effort: "low", format: zodOutputFormat(FullSchema) },
        });
        if (message.stop_reason === "refusal" || !message.parsed_output) return fail("The AI couldn't write this store. Try again or pick another product.");
        const out = message.parsed_output as { product: LaunchCopy; store: StoreCopy };
        copy = cleanCopy(out.product).copy;
        storeCopy = cleanStore(out.store);
      } else {
        const message = await claudeClient().messages.parse({
          model: MODEL,
          max_tokens: 6000,
          system: LAUNCH_SYSTEM,
          messages: [{ role: "user", content: productFacts }],
          output_config: { effort: "low", format: zodOutputFormat(CopySchema) },
        });
        if (message.stop_reason === "refusal" || !message.parsed_output) return fail("The AI couldn't write this page. Try again or pick another product.");
        copy = cleanCopy(message.parsed_output as LaunchCopy).copy;
      }
    } catch (e) {
      console.error("Launch: AI failed", e);
      return fail(e instanceof Anthropic.APIError ? claudeErrorMessage(e, false) : "The AI had a problem. Please try again.");
    }
    await ctx.runMutation(internal.launch.setStatus, {
      launchId: args.launchId,
      status: "publishing",
      copy,
      ...(storeCopy ? { store: storeCopy, step: "product" } : {}),
    });

    // 2. Create it in the store.
    try {
      const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      // The supplier cost is USD; Shopify wants it in the store's currency.
      const cost = product.cost ? Math.round(product.cost * rate * 100) / 100 : undefined;
      const input = launchProductInput(product, copy, {
        price: launch.price,
        cost,
        status: launch.publish === "ACTIVE" ? "ACTIVE" : "DRAFT",
        language: launch.language,
        forStoreTheme: fullStore,
      });
      const data = (await shopify(store.shopDomain, token, PRODUCT_SET, { input })) as {
        productSet?: { product: { id: string; handle: string; onlineStorePreviewUrl?: string } | null; userErrors: UserError[] };
      };
      const created = data.productSet?.product;
      if (!created) return fail(`Shopify: ${userErrors(data.productSet?.userErrors) || "the product wasn't created"}`);
      let storeUrl = created.onlineStorePreviewUrl;
      if (launch.publish === "ACTIVE") {
        // Put it on the Online Store sales channel (needs the app's publications scope).
        try {
          const pubs = (await shopify(store.shopDomain, token, "{ publications(first: 20) { nodes { id name } } }")) as { publications?: { nodes: { id: string; name: string }[] } };
          const online = pubs.publications?.nodes.find((p) => /online store/i.test(p.name));
          if (online) {
            await shopify(store.shopDomain, token, "mutation P($id: ID!, $pub: ID!) { publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }", { id: created.id, pub: online.id });
            storeUrl = `https://${store.shopDomain}/products/${created.handle}`;
          }
        } catch (e) {
          console.warn("Launch: couldn't publish to the Online Store", e);
        }
      }

      if (!fullStore || !storeCopy || !facts) {
        await ctx.runMutation(internal.launch.setStatus, {
          launchId: args.launchId,
          status: "published",
          shopifyProductId: created.id,
          adminUrl: `https://${store.shopDomain}/admin/products/${numericId(created.id)}`,
          ...(storeUrl ? { storeUrl } : {}),
        });
        return;
      }

      // 3. Full store: pages, menus, then the theme.
      await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "publishing", shopifyProductId: created.id, productHandle: created.handle, step: "pages" });
      const pages = await upsertPages(store.shopDomain, token, storePages(storeCopy, facts), store);
      await ctx.runMutation(internal.launch.saveStorePages, { userId: launch.userId, pages: Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.id])) });
      const menus = storeMenus(storeCopy, { productId: created.id, pages: Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.id])) }, copy.title || product.title);
      await upsertMenu(store.shopDomain, token, STORE_MENU_HANDLES.main, launch.brandName ?? "Main menu", menus.main);
      await upsertMenu(store.shopDomain, token, STORE_MENU_HANDLES.footer, `${launch.brandName ?? ""} footer`.trim(), menus.footer);
      const pageHandles = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.handle]));
      await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "publishing", pageHandles, step: "theme" });

      const secret = themeSecret();
      const site = process.env.CONVEX_SITE_URL;
      if (!secret || !site) return fail("Full store isn't set up on the server yet (missing SHOPIFY_TOKEN_KEY). The product and pages were created.");
      const source = `${site}/shopify/theme.zip?l=${args.launchId}&s=${await themeSignature(args.launchId, secret)}`;
      const style = STORE_STYLES[launch.style as keyof typeof STORE_STYLES];
      const name = `${launch.brandName ?? "Store"} · ${style.name}`.slice(0, 50);
      const t = (await shopify(store.shopDomain, token, THEME_CREATE, { source, name })) as {
        themeCreate?: { theme: { id: string; processing: boolean } | null; userErrors: UserError[] };
      };
      const theme = t.themeCreate?.theme;
      if (!theme) return fail(`Shopify couldn't install the theme: ${userErrors(t.themeCreate?.userErrors) || "unknown error"}`);
      // Shopify unpacks the zip in the background; wait for it (up to ~2 minutes).
      for (let i = 0; i < 40; i++) {
        const st = (await shopify(store.shopDomain, token, THEME_STATUS, { id: theme.id })) as { theme?: { processing: boolean; processingFailed: boolean } };
        if (st.theme?.processingFailed) return fail("Shopify couldn't process the theme. Please try again.");
        if (st.theme && !st.theme.processing) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      const id = numericId(theme.id);
      await ctx.runMutation(internal.launch.setStatus, {
        launchId: args.launchId,
        status: "published",
        adminUrl: `https://${store.shopDomain}/admin/products/${numericId(created.id)}`,
        ...(storeUrl ? { storeUrl } : {}),
        themeId: theme.id,
        themePreviewUrl: `https://${store.shopDomain}/?preview_theme_id=${id}`,
        themeEditorUrl: `https://${store.shopDomain}/admin/themes/${id}/editor`,
        step: "done",
      });
    } catch (e) {
      console.error("Launch: publish failed", e);
      return fail(e instanceof Error ? e.message : "Publishing to Shopify failed.");
    }
  },
});

/** Creates the store's pages, or updates the ones an earlier Full store launch made. */
async function upsertPages(
  shop: string,
  token: string,
  pages: ReturnType<typeof storePages>,
  conn: Doc<"shopifyConnections">,
): Promise<Partial<Record<StorePageKey, { id: string; handle: string }>>> {
  const out: Partial<Record<StorePageKey, { id: string; handle: string }>> = {};
  for (const key of Object.keys(pages) as StorePageKey[]) {
    const p = pages[key];
    const page = { title: p.title, body: p.body, isPublished: true, ...(p.templateSuffix ? { templateSuffix: p.templateSuffix } : {}) };
    const existing = conn.storePages?.[key];
    if (existing) {
      const r = (await shopify(shop, token, PAGE_UPDATE, { id: existing, page })) as { pageUpdate?: { page: { id: string; handle: string } | null; userErrors: UserError[] } };
      if (r.pageUpdate?.page) {
        out[key] = r.pageUpdate.page;
        continue;
      }
      // Deleted in Shopify since: create it again.
    }
    const r = (await shopify(shop, token, PAGE_CREATE, { page: { ...page, handle: p.handle } })) as {
      pageCreate?: { page: { id: string; handle: string } | null; userErrors: UserError[] };
    };
    if (r.pageCreate?.page) out[key] = r.pageCreate.page;
    else console.warn(`Launch: page ${key} not created: ${userErrors(r.pageCreate?.userErrors)}`);
  }
  return out;
}

/** Creates or replaces one of our menus (our own handles, so the live theme's menus aren't touched). */
async function upsertMenu(shop: string, token: string, handle: string, title: string, items: ReturnType<typeof storeMenus>["main"]) {
  const list = (await shopify(shop, token, MENUS)) as { menus?: { nodes: { id: string; handle: string }[] } };
  const existing = list.menus?.nodes.find((m) => m.handle === handle);
  const r = existing
    ? ((await shopify(shop, token, MENU_UPDATE, { id: existing.id, title, handle, items })) as { menuUpdate?: { userErrors: UserError[] } }).menuUpdate
    : ((await shopify(shop, token, MENU_CREATE, { title, handle, items })) as { menuCreate?: { userErrors: UserError[] } }).menuCreate;
  if (r?.userErrors?.length) console.warn(`Launch: menu ${handle}: ${userErrors(r.userErrors)}`);
}

/** Makes a Full store theme the live theme (launch.publishTheme). */
export const publishTheme = internalAction({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.launch.context, { launchId: args.launchId });
    const themeId = c?.launch.themeId;
    if (!c?.store || !themeId) return;
    try {
      const token = await decryptToken(c.store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      const r = (await shopify(c.store.shopDomain, token, THEME_PUBLISH, { id: themeId })) as { themePublish?: { theme: { role: string } | null; userErrors: UserError[] } };
      if (!r.themePublish?.theme) throw new Error(`Shopify: ${userErrors(r.themePublish?.userErrors) || "the theme wasn't published"}`);
      await ctx.runMutation(internal.launch.markThemeLive, { launchId: args.launchId });
    } catch (e) {
      await ctx.runMutation(internal.launch.markThemeLive, { launchId: args.launchId, error: (e instanceof Error ? e.message : "Publishing the theme failed.").slice(0, 300) });
    }
  },
});
