"use node";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { claudeClient } from "./lib/claudeClient";
import { decryptToken, missingStoreScopes } from "./lib/shopifyOAuth";
import { SHOPIFY_API_VERSION } from "./lib/shopifyExport";
import {
  LANDING_FILES,
  LANDING_TEMPLATE_SUFFIX,
  LINKS_GUIDE,
  TEMPLATE_STEPS,
  deadLinks,
  homeTemplate,
  isLandingHome,
  linksPrompt,
  pickedLinks,
  setLinks,
  storeLinks,
  storePath,
  withDoctype,
  type StoreLink,
} from "./lib/landingShopify";

// Screenshot to page → "Publish to Shopify": the page becomes a page in the user's connected store
// (yourstore.com/pages/…), shown by the adspy-landing template without the theme around it, and, if asked, the
// store's home page (the theme's own home template is kept to restore). Links that go nowhere ("#") are pointed at
// the store's menu, collections, pages and products first. Publishing again updates the same page.

type UserError = { field?: string[] | null; message: string };
const errorsText = (errs: UserError[] | undefined) => (errs ?? []).map((e) => e.message).join("; ");
const numericId = (gid: string) => gid.split("/").pop() ?? gid;
const HOME_FILE = "templates/index.json";

async function gql(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ConvexError({ code: "RECONNECT", message: "Shopify refused access. Reconnect your store in Settings → Shopify." });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { message: string }[] | string };
    if (!res.ok || body.errors) {
      const msg = typeof body.errors === "string" ? body.errors : (body.errors ?? []).map((e) => e.message).join("; ");
      if (/access denied|required access/i.test(msg)) throw new ConvexError({ code: "ACCESS", message: msg.slice(0, 300) });
      throw new ConvexError({ code: "SHOPIFY", message: `Shopify: ${msg || `HTTP ${res.status}`}`.slice(0, 300) });
    }
    return body.data ?? {};
  }
  throw new ConvexError({ code: "SHOPIFY", message: "Shopify is busy right now. Please try again in a minute." });
}

const MAIN_THEME = `query MainTheme($files: [String!]!) {
  shop { myshopifyDomain primaryDomain { url host } }
  themes(first: 1, roles: [MAIN]) { nodes { id name files(filenames: $files, first: 10) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }
}`;
const FILES_UPSERT = `mutation Upsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message } }
}`;
const STORE_LINKS = `{
  menus(first: 5) { nodes { handle items { title url items { title url } } } }
  collections(first: 50) { nodes { title handle } }
  pages(first: 50) { nodes { title handle } }
  products(first: 50, sortKey: UPDATED_AT, reverse: true) { nodes { title handle } }
}`;
const PAGE_CREATE = `mutation PageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { field message } }
}`;
const PAGE_UPDATE = `mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
}`;
const PAGE_BODY = `query PageBody($id: ID!) { page(id: $id) { body } }`;

type Theme = { id: string; files?: { nodes: { filename: string; body?: { content?: string } }[] } };
type MainTheme = { shop?: { myshopifyDomain?: string; primaryDomain?: { url?: string; host?: string } }; themes?: { nodes: Theme[] } };

async function signedIn(ctx: ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
  return stableToken(identity);
}

async function connection(ctx: ActionCtx, id: Id<"screenPages">) {
  const c = await ctx.runQuery(internal.screenPages.publishContext, { token: await signedIn(ctx), id });
  if (!c) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
  const { store } = c;
  if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first (Settings → Shopify)." });
  if (store.via === "oauth" && missingStoreScopes(store.scopes ?? "").length) {
    throw new ConvexError({ code: "RECONNECT", message: "Publishing pages needs new permissions. Reconnect your Shopify store (Settings → Shopify), then try again." });
  }
  return { ...c, store, token: await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim()) };
}

async function mainTheme(shop: string, token: string, files: string[]): Promise<{ main: MainTheme; theme: Theme; file: (name: string) => string | undefined }> {
  const main = (await gql(shop, token, MAIN_THEME, { files })) as MainTheme;
  const theme = main.themes?.nodes[0];
  if (!theme) throw new ConvexError({ code: "NO_THEME", message: "Your store has no live theme to show the page with." });
  const file = (name: string) => theme.files?.nodes.find((f) => f.filename === name)?.body?.content;
  return { main, theme, file };
}

/** Writes theme files; the reason Shopify gave when it refused. */
async function upsert(shop: string, token: string, themeId: string, files: Record<string, string>): Promise<string> {
  try {
    const r = (await gql(shop, token, FILES_UPSERT, {
      themeId,
      files: Object.entries(files).map(([filename, value]) => ({ filename, body: { type: "TEXT", value } })),
    })) as { themeFilesUpsert?: { upsertedThemeFiles?: { filename: string }[] | null; userErrors: UserError[] } };
    const written = r.themeFilesUpsert?.upsertedThemeFiles?.length ?? 0;
    return written >= Object.keys(files).length ? "" : errorsText(r.themeFilesUpsert?.userErrors) || "not all files were written";
  } catch (e) {
    if (!(e instanceof ConvexError) || (e.data as { code?: string }).code === "RECONNECT") throw e;
    return String((e.data as { message?: string }).message ?? "refused");
  }
}

/** The page's links that go nowhere, pointed at the store's pages by a small AI request; the page unchanged when that fails. */
async function linkToStore(shop: string, token: string, html: string, hosts: string[]): Promise<{ html: string; linked: number }> {
  const dead = deadLinks(html).slice(0, 80);
  if (!dead.length || !process.env.ANTHROPIC_API_KEY) return { html, linked: 0 };
  const found = (await gql(shop, token, STORE_LINKS)) as {
    menus?: { nodes: { handle: string; items: { title: string; url: string | null; items?: { title: string; url: string | null }[] }[] }[] };
    collections?: { nodes: { title: string; handle: string }[] };
    pages?: { nodes: { title: string; handle: string }[] };
    products?: { nodes: { title: string; handle: string }[] };
  };
  const menuLinks: StoreLink[] = [];
  for (const m of found.menus?.nodes ?? []) {
    for (const item of m.items.flatMap((i) => [i, ...(i.items ?? [])])) {
      const path = item.url ? storePath(item.url, hosts) : null;
      if (path) menuLinks.push({ label: `Menu "${m.handle}": ${item.title}`, url: path });
    }
  }
  const links = storeLinks({
    menus: menuLinks,
    collections: (found.collections?.nodes ?? []).map((c) => ({ label: c.title, url: `/collections/${c.handle}` })),
    pages: (found.pages?.nodes ?? []).filter((p) => !p.handle.startsWith("adspy-")).map((p) => ({ label: p.title, url: `/pages/${p.handle}` })),
    products: (found.products?.nodes ?? []).map((p) => ({ label: p.title, url: `/products/${p.handle}` })),
  });
  try {
    const message = await claudeClient().messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 3000,
      system: LINKS_GUIDE,
      messages: [{ role: "user", content: linksPrompt(links, dead) }],
      output_config: { effort: "low", format: zodOutputFormat(z.object({ links: z.array(z.object({ i: z.number(), url: z.string().nullable() })) })) },
    });
    const picked = pickedLinks(message.stop_reason === "refusal" ? null : message.parsed_output, dead, links);
    return { html: setLinks(html, picked), linked: Object.keys(picked).length };
  } catch (e) {
    console.warn("Publish page: links not set", e instanceof Error ? e.message : e);
    return { html, linked: 0 };
  }
}

export const publish = action({
  args: { id: v.id("screenPages"), asHome: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ url: string; adminUrl: string; updated: boolean; home: boolean; linked: number; note?: string }> => {
    const { page, store, token, userId } = await connection(ctx, args.id);
    if (!page.html || page.status === "making") throw new ConvexError({ code: "NOT_READY", message: "The page isn't ready yet." });
    const shop = store.shopDomain;

    // 1. The landing files in the live theme (added or brought up to date), before any page uses them.
    const { main, theme, file } = await mainTheme(shop, token, [...Object.keys(LANDING_FILES), HOME_FILE]);
    const stale = Object.fromEntries(Object.entries(LANDING_FILES).filter(([name, content]) => file(name) !== content));
    if (Object.keys(stale).length) {
      const refused = await upsert(shop, token, theme.id, stale);
      if (refused) {
        console.warn("Publish page: landing files not added", shop, refused);
        throw new ConvexError({ code: "TEMPLATE_NEEDED", message: TEMPLATE_STEPS, files: LANDING_FILES });
      }
    }
    const homeNow = file(HOME_FILE);
    if (args.asHome && homeNow === undefined) {
      throw new ConvexError({ code: "OLD_THEME", message: "Your theme's home page isn't a JSON template (an older theme), so the landing page can't replace it. Publish it as a page instead." });
    }

    // 2. Its menu bar and buttons, linked to the store.
    const origin = (main.shop?.primaryDomain?.url ?? `https://${shop}`).replace(/\/$/, "");
    const hosts = [shop, main.shop?.myshopifyDomain, main.shop?.primaryDomain?.host].filter((h): h is string => !!h).map((h) => h.toLowerCase());
    const { html, linked } = await linkToStore(shop, token, page.html, hosts);

    // 3. The page: the same one again when it was published to this store before.
    const fields = { title: page.title, body: withDoctype(html), templateSuffix: LANDING_TEMPLATE_SUFFIX, isPublished: true };
    let made: { id: string; handle: string } | null = null;
    let updated = false;
    if (page.shopify?.shopDomain === shop) {
      const r = (await gql(shop, token, PAGE_UPDATE, { id: page.shopify.pageId, page: fields })) as { pageUpdate?: { page: { id: string; handle: string } | null } };
      made = r.pageUpdate?.page ?? null;
      updated = !!made; // deleted in Shopify meanwhile: made again below
    }
    if (!made) {
      const r = (await gql(shop, token, PAGE_CREATE, { page: fields })) as { pageCreate?: { page: { id: string; handle: string } | null; userErrors: UserError[] } };
      made = r.pageCreate?.page ?? null;
      if (!made) throw new ConvexError({ code: "SHOPIFY", message: `Shopify didn't create the page: ${errorsText(r.pageCreate?.userErrors) || "no reason given"}`.slice(0, 300) });
    }

    // 4. The home page: the theme's own template is kept first (never a landing page's), then points at this page.
    let home = !!(page.shopify?.home && page.shopify.shopDomain === shop);
    let note: string | undefined;
    if (args.asHome) {
      if (homeNow && !isLandingHome(homeNow)) await ctx.runMutation(internal.screenPages.saveHomeBackup, { userId, shopDomain: shop, themeId: theme.id, content: homeNow });
      else if (!(await ctx.runQuery(internal.screenPages.homeBackup, { shopDomain: shop, themeId: theme.id }))) {
        note = "The theme's earlier home page wasn't saved by AdSpy, so Restore won't be able to bring it back.";
      }
      const refused = await upsert(shop, token, theme.id, { [HOME_FILE]: homeTemplate(made.handle) });
      if (refused) throw new ConvexError({ code: "SHOPIFY", message: `The page is published, but Shopify didn't let AdSpy make it the home page: ${refused}`.slice(0, 300) });
      await ctx.runMutation(internal.screenPages.homeMovedTo, { userId, shopDomain: shop, id: args.id });
      home = true;
    }

    // 5. Shopify keeps a page's HTML as sent; if it ever cleans out the head and scripts, the page loses its styling.
    const check = (await gql(shop, token, PAGE_BODY, { id: made.id })) as { page?: { body?: string } };
    if (/cdn\.tailwindcss\.com/.test(html) && !/cdn\.tailwindcss\.com/.test(check.page?.body ?? "")) {
      note = "Shopify removed the page's styling code, so it may look unstyled. Download the page and host it elsewhere instead.";
    }
    const result = {
      shopDomain: shop,
      pageId: made.id,
      url: home ? `${origin}/` : `${origin}/pages/${made.handle}`,
      adminUrl: `https://${shop}/admin/pages/${numericId(made.id)}`,
      publishedAt: Date.now(),
      home,
    };
    await ctx.runMutation(internal.screenPages.published, { id: args.id, shopify: result, ...(linked ? { linkedHtml: html } : {}) });
    return { url: result.url, adminUrl: result.adminUrl, updated, home, linked, ...(note ? { note } : {}) };
  },
});

/** The theme's own home page back (as saved before the first landing page replaced it). */
export const restoreHome = action({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args): Promise<void> => {
    const { store, token, userId } = await connection(ctx, args.id);
    const shop = store.shopDomain;
    const { theme } = await mainTheme(shop, token, [HOME_FILE]);
    const backup = await ctx.runQuery(internal.screenPages.homeBackup, { shopDomain: shop, themeId: theme.id });
    if (!backup) {
      throw new ConvexError({ code: "NO_BACKUP", message: "AdSpy has no copy of this theme's earlier home page. Pick another home page in Online Store → Themes → Customize." });
    }
    const refused = await upsert(shop, token, theme.id, { [HOME_FILE]: backup.content });
    if (refused) throw new ConvexError({ code: "SHOPIFY", message: `Shopify didn't restore the home page: ${refused}`.slice(0, 300) });
    await ctx.runMutation(internal.screenPages.homeRestored, { userId, shopDomain: shop });
  },
});
