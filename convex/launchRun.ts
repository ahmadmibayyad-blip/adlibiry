"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import * as z from "zod";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { photoPrompts, withAiPhotos } from "./lib/aiPhotos";
import { firstPhoto, generateImage } from "./lib/aiPhotoRun";
import { LAUNCH_SYSTEM, cleanCopy, launchFacts, launchImages, launchProductInput, type LaunchCopy } from "./lib/launchCopy";
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
// With aiPhotos > 0, new product photos are made from the real one first (lib/aiPhotos.ts).

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

// Kept small: Anthropic compiles a strict schema into a grammar with a size
// limit ("compiled grammar is too large"), so no enums (icons are checked in
// cleanStore) and the store is its own request, next to the product page's.
const titled = z.object({ title: z.string(), text: z.string() });
const StoreSchema = z.object({
  announcement: z.string(),
  hero: z.object({ eyebrow: z.string(), heading: z.string(), text: z.string(), button: z.string(), points: z.array(z.string()) }),
  trust: z.array(z.object({ icon: z.string(), text: z.string() })),
  benefits: z.object({ heading: z.string(), text: z.string(), items: z.array(z.object({ icon: z.string(), title: z.string(), text: z.string() })) }),
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

const STORE_GUIDE =
  "Write the store: announcement (one short line, e.g. the delivery time or free shipping if given), hero (eyebrow 2–4 words, " +
  "heading max 8 words, text 1–2 sentences, button 2–3 words, 3 short points), trust (3–4 items: delivery, secure checkout, returns, " +
  "support), benefits (heading, one-sentence intro, 3–4 items with an icon each), steps (3 items: how to use it), story (why we " +
  "picked this product, 2 short paragraphs, button to the About page), faq (6–8 buyer questions incl. delivery and returns, answered " +
  "only from the facts), newsletter (heading + one line; no discount unless given), footerText (one sentence), productTrust (three " +
  "short lines under the buy button: delivery, returns, payment), pages (About: 3–4 paragraphs; Shipping & returns: 4–6 paragraphs " +
  "from the store facts only, telling customers to contact support to start a return; FAQ page title; Contact title + one-line intro), " +
  "and menu labels. " +
  `Trust icons: one of ${TRUST_ICONS.join(", ")}. Benefit icons: one of ${STORE_ICONS.join(", ")}.`;

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
    const { launch, product, store, ads, rate, previousShopifyProductId } = c;
    const fullStore = launch.mode === "store" && isStoreStyle(launch.style);
    const facts = launch.facts as StoreFacts | undefined;

    // 1. Write the page and ad kit (and for a full store, the rest of the store).
    let copy: LaunchCopy;
    let storeCopy: StoreCopy | undefined;
    try {
      if (!process.env.ANTHROPIC_API_KEY) return fail("The AI isn't set up yet (missing ANTHROPIC_API_KEY).");
      const productFacts = launchFacts(product, ads, { language: launch.language, tone: launch.tone, price: launch.price });
      const writePage = async () => {
        const message = await claudeClient().messages.parse({
          model: MODEL,
          max_tokens: 6000,
          system: LAUNCH_SYSTEM,
          messages: [{ role: "user", content: productFacts }],
          output_config: { effort: "low", format: zodOutputFormat(CopySchema) },
        });
        return message.stop_reason === "refusal" ? null : (message.parsed_output as LaunchCopy | null);
      };
      if (fullStore && facts) {
        const style = STORE_STYLES[launch.style as keyof typeof STORE_STYLES];
        const system = `${LAUNCH_SYSTEM}\n\n${STORE_SYSTEM}`;
        const content = `${productFacts}\nStore name: ${launch.brandName}\nStore style: ${style.name} (${style.description})\n${storeFacts(facts)}\n\n${STORE_GUIDE}`;
        const writeStore = async (): Promise<StoreCopy | null> => {
          try {
            const message = await claudeClient().messages.parse({
              model: MODEL,
              max_tokens: 10000,
              system,
              messages: [{ role: "user", content }],
              output_config: { effort: "low", format: zodOutputFormat(StoreSchema) },
            });
            return message.stop_reason === "refusal" ? null : (message.parsed_output as StoreCopy | null);
          } catch (e) {
            // A strict schema the API won't compile: ask for the same JSON as plain text (cleanStore checks every field).
            if (!(e instanceof Anthropic.BadRequestError && /grammar|schema/i.test(e.message))) throw e;
            console.warn("Launch: store schema rejected, retrying as plain JSON", e.message);
            const message = await claudeClient().messages.create({
              model: MODEL,
              max_tokens: 10000,
              system,
              messages: [{ role: "user", content: `${content}\n\nReturn only one JSON object matching this JSON Schema, no other text:\n${JSON.stringify(z.toJSONSchema(StoreSchema))}` }],
              output_config: { effort: "low" },
            });
            const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
            const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
            try {
              return JSON.parse(json) as StoreCopy;
            } catch {
              return null;
            }
          }
        };
        // Two requests at once: the product page and the rest of the store.
        const [page, storeOut] = await Promise.all([writePage(), writeStore()]);
        if (!page || !storeOut) return fail("The AI couldn't write this store. Try again or pick another product.");
        copy = cleanCopy(page).copy;
        storeCopy = cleanStore(storeOut);
      } else {
        const page = await writePage();
        if (!page) return fail("The AI couldn't write this page. Try again or pick another product.");
        copy = cleanCopy(page).copy;
      }
    } catch (e) {
      console.error("Launch: AI failed", e);
      return fail(e instanceof Anthropic.APIError ? claudeErrorMessage(e, false) : "The AI had a problem. Please try again.");
    }
    const wantsPhotos = (launch.aiPhotos ?? 0) > 0;
    await ctx.runMutation(internal.launch.setStatus, {
      launchId: args.launchId,
      status: "publishing",
      copy,
      ...(storeCopy ? { store: storeCopy } : {}),
      ...(wantsPhotos ? { step: "photos" } : storeCopy ? { step: "product" } : {}),
    });

    // 2. AI product photos, made from the first real photo that downloads. A failure here never stops the launch.
    const realPhotos = launchImages([product.imageUrl, ...(product.images ?? [])]);
    let photos = realPhotos;
    if (wantsPhotos) {
      const made = await makeAiPhotos(ctx, product, realPhotos, launch.aiPhotos ?? 0);
      photos = withAiPhotos(realPhotos, made.urls);
      await ctx.runMutation(internal.launch.setStatus, {
        launchId: args.launchId,
        status: "publishing",
        aiPhotoUrls: made.urls,
        aiPhotoIds: made.ids,
        ...(made.note ? { aiPhotoNote: made.note } : {}),
        ...(storeCopy ? { step: "product" } : {}),
      });
    }

    // 3. Create it in the store.
    try {
      const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      // The supplier cost is USD; Shopify wants it in the store's currency.
      const cost = product.cost ? Math.round(product.cost * rate * 100) / 100 : undefined;
      const input = launchProductInput({ ...product, imageUrl: photos[0] ?? "", images: photos.slice(1) }, copy, {
        price: launch.price,
        cost,
        status: launch.publish === "ACTIVE" ? "ACTIVE" : "DRAFT",
        language: launch.language,
        forStoreTheme: fullStore,
      });
      const created = await upsertProduct(store.shopDomain, token, input, previousShopifyProductId);
      if ("error" in created) return fail(created.error);
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

type ProductSetResult = { productSet?: { product: { id: string; handle: string; onlineStorePreviewUrl?: string } | null; userErrors: UserError[] } };

/**
 * Creates the product, or updates the one an earlier launch of it made (so
 * launching again doesn't fail on "handle already in use" or duplicate it).
 * A handle taken by another product gets a short suffix.
 */
/** Makes `count` AI photos of the product and keeps them in Convex storage, so Shopify can download them. */
async function makeAiPhotos(
  ctx: ActionCtx,
  product: Doc<"products">,
  realPhotos: string[],
  count: number,
): Promise<{ urls: string[]; ids: Id<"_storage">[]; note?: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { urls: [], ids: [], note: "AI photos aren't switched on yet." };
  const photo = await firstPhoto(realPhotos);
  if (!photo) return { urls: [], ids: [], note: "No AI photos: the product has no photo we could download to work from." };
  // Made at the same time, stored one by one.
  const made = await Promise.all(photoPrompts(product, count).map((prompt) => generateImage(key, prompt, photo)));
  const results: ({ id: Id<"_storage">; url: string } | { error: string })[] = [];
  for (const image of made) {
    if ("error" in image) {
      results.push(image);
      continue;
    }
    const id = await ctx.storage.store(image);
    const url = await ctx.storage.getUrl(id);
    results.push(url ? { id, url } : { error: "storage" });
  }
  const ok = results.filter((r): r is { id: Id<"_storage">; url: string } => "url" in r);
  const failed = results.filter((r): r is { error: string } => "error" in r);
  if (failed.length) console.warn("Launch: AI photos failed", failed.map((f) => f.error.slice(0, 200)));
  return {
    urls: ok.map((r) => r.url),
    ids: ok.map((r) => r.id),
    ...(failed.length ? { note: ok.length ? `${failed.length} of ${results.length} AI photos couldn't be made.` : "The AI photos couldn't be made this time." } : {}),
  };
}

async function upsertProduct(
  shop: string,
  token: string,
  input: ReturnType<typeof launchProductInput>,
  previousId: string | undefined,
): Promise<{ id: string; handle: string; onlineStorePreviewUrl?: string } | { error: string }> {
  const attempt = async (i: Record<string, unknown>) => ((await shopify(shop, token, PRODUCT_SET, { input: i })) as ProductSetResult).productSet;
  let r = previousId ? await attempt({ ...input, id: previousId }) : undefined;
  if (r?.product) return r.product;
  // No earlier product, or it was deleted in Shopify since.
  r = await attempt(input);
  if (!r?.product && /handle/i.test(userErrors(r?.userErrors)) && /in use|taken|already/i.test(userErrors(r?.userErrors))) {
    r = await attempt({ ...input, handle: `${input.handle}-${Math.random().toString(36).slice(2, 6)}` });
  }
  return r?.product ?? { error: `Shopify: ${userErrors(r?.userErrors) || "the product wasn't created"}` };
}

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
