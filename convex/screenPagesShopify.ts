import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { decryptToken, missingStoreScopes } from "./lib/shopifyOAuth";
import { SHOPIFY_API_VERSION } from "./lib/shopifyExport";
import { LANDING_TEMPLATE, LANDING_TEMPLATE_FILE, LANDING_TEMPLATE_SUFFIX, TEMPLATE_STEPS } from "./lib/screenPage";

// Screenshot to page → "Publish to Shopify": the page becomes a page in the user's connected store
// (yourstore.com/pages/…), shown by the adspy-landing template without the theme around it. The template
// is added to the live theme once (and ships in both Launch themes); publishing again updates the same page.

type UserError = { field?: string[] | null; message: string };
const errorsText = (errs: UserError[] | undefined) => (errs ?? []).map((e) => e.message).join("; ");
const numericId = (gid: string) => gid.split("/").pop() ?? gid;

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
  shop { primaryDomain { url } }
  themes(first: 1, roles: [MAIN]) { nodes { id name files(filenames: $files, first: 1) { nodes { filename } } } }
}`;
const FILES_UPSERT = `mutation Upsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message } }
}`;
const PAGE_CREATE = `mutation PageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { field message } }
}`;
const PAGE_UPDATE = `mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
}`;
const PAGE_BODY = `query PageBody($id: ID!) { page(id: $id) { body } }`;

export const context = internalQuery({
  args: { token: v.string(), id: v.id("screenPages") },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const page = await ctx.db.get("screenPages", args.id);
    if (!page || page.userId !== user._id) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return { page, store };
  },
});

export const saved = internalMutation({
  args: { id: v.id("screenPages"), shopify: v.object({ shopDomain: v.string(), pageId: v.string(), url: v.string(), adminUrl: v.string(), publishedAt: v.number() }) },
  handler: async (ctx, args) => {
    await ctx.db.patch("screenPages", args.id, { shopify: args.shopify });
  },
});

export const publish = action({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args): Promise<{ url: string; adminUrl: string; updated: boolean; note?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const c = await ctx.runQuery(internal.screenPagesShopify.context, { token: stableToken(identity), id: args.id });
    if (!c) throw new ConvexError({ code: "NOT_FOUND", message: "Page not found." });
    const { page, store } = c;
    if (!page.html || page.status === "making") throw new ConvexError({ code: "NOT_READY", message: "The page isn't ready yet." });
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first (Settings → Shopify)." });
    if (store.via === "oauth" && missingStoreScopes(store.scopes ?? "").length) {
      throw new ConvexError({ code: "RECONNECT", message: "Publishing pages needs new permissions. Reconnect your Shopify store (Settings → Shopify), then try again." });
    }
    const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
    const shop = store.shopDomain;

    // 1. The template, in the live theme (once).
    const main = (await gql(shop, token, MAIN_THEME, { files: [LANDING_TEMPLATE_FILE] })) as {
      shop?: { primaryDomain?: { url?: string } };
      themes?: { nodes: { id: string; files?: { nodes: { filename: string }[] } }[] };
    };
    const theme = main.themes?.nodes[0];
    if (!theme) throw new ConvexError({ code: "NO_THEME", message: "Your store has no live theme to show the page with." });
    if (!theme.files?.nodes.length) {
      let refused = "";
      try {
        const r = (await gql(shop, token, FILES_UPSERT, {
          themeId: theme.id,
          files: [{ filename: LANDING_TEMPLATE_FILE, body: { type: "TEXT", value: LANDING_TEMPLATE } }],
        })) as { themeFilesUpsert?: { upsertedThemeFiles?: { filename: string }[] | null; userErrors: UserError[] } };
        if (!r.themeFilesUpsert?.upsertedThemeFiles?.length) refused = errorsText(r.themeFilesUpsert?.userErrors) || "no file written";
      } catch (e) {
        if (!(e instanceof ConvexError) || (e.data as { code?: string }).code === "RECONNECT") throw e;
        refused = String((e.data as { message?: string }).message ?? "");
      }
      if (refused) {
        console.warn("Publish page: template not added", shop, refused);
        throw new ConvexError({ code: "TEMPLATE_NEEDED", message: TEMPLATE_STEPS, template: LANDING_TEMPLATE });
      }
    }

    // 2. The page: the same one again when it was published to this store before.
    const fields = { title: page.title, body: page.html, templateSuffix: LANDING_TEMPLATE_SUFFIX };
    let made: { id: string; handle: string } | null = null;
    let updated = false;
    if (page.shopify?.shopDomain === shop) {
      const r = (await gql(shop, token, PAGE_UPDATE, { id: page.shopify.pageId, page: { ...fields, isPublished: true } })) as {
        pageUpdate?: { page: { id: string; handle: string } | null; userErrors: UserError[] };
      };
      made = r.pageUpdate?.page ?? null;
      updated = !!made; // deleted in Shopify meanwhile: made again below
    }
    if (!made) {
      const r = (await gql(shop, token, PAGE_CREATE, { page: { ...fields, isPublished: true } })) as {
        pageCreate?: { page: { id: string; handle: string } | null; userErrors: UserError[] };
      };
      made = r.pageCreate?.page ?? null;
      if (!made) throw new ConvexError({ code: "SHOPIFY", message: `Shopify didn't create the page: ${errorsText(r.pageCreate?.userErrors) || "no reason given"}`.slice(0, 300) });
    }

    // 3. Shopify keeps a page's HTML as sent; if it ever cleans out the head and scripts, the page loses its styling.
    const check = (await gql(shop, token, PAGE_BODY, { id: made.id })) as { page?: { body?: string } };
    const kept = !/cdn\.tailwindcss\.com/.test(page.html) || /cdn\.tailwindcss\.com/.test(check.page?.body ?? "");
    const origin = (main.shop?.primaryDomain?.url ?? `https://${shop}`).replace(/\/$/, "");
    const result = {
      shopDomain: shop,
      pageId: made.id,
      url: `${origin}/pages/${made.handle}`,
      adminUrl: `https://${shop}/admin/pages/${numericId(made.id)}`,
      publishedAt: Date.now(),
    };
    await ctx.runMutation(internal.screenPagesShopify.saved, { id: args.id, shopify: result });
    return {
      url: result.url,
      adminUrl: result.adminUrl,
      updated,
      ...(kept ? {} : { note: "Shopify removed the page's styling code, so it may look unstyled. Download the page and host it elsewhere instead." }),
    };
  },
});
