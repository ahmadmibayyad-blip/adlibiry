import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { normalizeShopDomain, productSetInput, SHOPIFY_API_VERSION } from "./lib/shopifyExport";

// ── One-click Shopify import ────────────────────────────────────────────────
// The user connects their store with a custom-app Admin API token (scope
// write_products; Launch and Full store need more, see src/components/ShopifyTokenForm.tsx). "Add to Shopify" then creates the product as a draft via
// the productSet mutation. Product mapping: convex/lib/shopifyExport.ts.

async function currentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

async function shopifyGraphql(shopDomain: string, accessToken: string, query: string, variables?: object) {
  let res: Response;
  try {
    res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new ConvexError({ code: "SHOPIFY", message: "Couldn't reach your Shopify store. Check the store address." });
  }
  if (res.status === 401 || res.status === 403) {
    throw new ConvexError({ code: "SHOPIFY", message: "Shopify refused the access token. Check it, and that the app has the write_products scope." });
  }
  if (res.status === 404) throw new ConvexError({ code: "SHOPIFY", message: "No Shopify store at that address." });
  if (!res.ok) throw new ConvexError({ code: "SHOPIFY", message: `Shopify answered ${res.status}. Try again in a minute.` });
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] | string };
  if (body.errors) {
    const msg = typeof body.errors === "string" ? body.errors : body.errors.map((e) => e.message).join("; ");
    throw new ConvexError({ code: "SHOPIFY", message: `Shopify error: ${msg.slice(0, 300)}` });
  }
  return body.data ?? {};
}

// What the page may see: never the token.
export const connection = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const c = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return c ? { shopDomain: c.shopDomain, shopName: c.shopName, connectedAt: c.connectedAt } : null;
  },
});

export const connect = action({
  args: { shopDomain: v.string(), accessToken: v.string() },
  handler: async (ctx, args): Promise<{ shopName: string; shopDomain: string }> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const shopDomain = normalizeShopDomain(args.shopDomain);
    if (!shopDomain) throw new ConvexError({ code: "BAD_REQUEST", message: "Enter your store's .myshopify.com address, e.g. my-store.myshopify.com" });
    const accessToken = args.accessToken.trim();
    if (!/^shpat_[A-Za-z0-9]{20,}$/.test(accessToken)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "That isn't an Admin API access token. It starts with shpat_." });
    }
    const data = (await shopifyGraphql(shopDomain, accessToken, "{ shop { name myshopifyDomain currencyCode } }")) as {
      shop?: { name: string; myshopifyDomain: string; currencyCode?: string };
    };
    if (!data.shop) throw new ConvexError({ code: "SHOPIFY", message: "Shopify didn't return the store details." });
    const saved = { shopDomain: data.shop.myshopifyDomain || shopDomain, shopName: data.shop.name };
    const locale = await primaryLocale(saved.shopDomain, accessToken);
    await ctx.runMutation(internal.shopifyImport.saveConnection, {
      userId: user._id,
      ...saved,
      accessToken,
      ...(data.shop.currencyCode ? { currency: data.shop.currencyCode } : {}),
      ...(locale ? { locale } : {}),
    });
    return saved;
  },
});

/** The store's main language ("da"); needs read_locales, which older tokens may not have. */
async function primaryLocale(shopDomain: string, accessToken: string): Promise<string | undefined> {
  try {
    const d = (await shopifyGraphql(shopDomain, accessToken, "{ shopLocales(published: true) { locale primary } }")) as {
      shopLocales?: { locale: string; primary: boolean }[];
    };
    return d.shopLocales?.find((l) => l.primary)?.locale;
  } catch {
    return undefined;
  }
}

/**
 * Stores connected with a token before we saved the currency: reads it (and the
 * language) once, so Launch prices in the store's currency instead of USD.
 */
export const refreshStoreInfo = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) return;
    const c = await ctx.runQuery(internal.shopifyImport.connectionFor, { userId: user._id });
    // App installs store an encrypted token and already have the currency.
    if (!c || c.currency || c.accessToken.startsWith("enc:")) return;
    try {
      const data = (await shopifyGraphql(c.shopDomain, c.accessToken, "{ shop { currencyCode } }")) as { shop?: { currencyCode?: string } };
      const locale = c.locale ? undefined : await primaryLocale(c.shopDomain, c.accessToken);
      if (data.shop?.currencyCode || locale) {
        await ctx.runMutation(internal.shopifyImport.patchStoreInfo, {
          id: c._id,
          ...(data.shop?.currencyCode ? { currency: data.shop.currencyCode } : {}),
          ...(locale ? { locale } : {}),
        });
      }
    } catch (e) {
      console.warn("refreshStoreInfo failed", e);
    }
  },
});

export const connectionFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique(),
});

export const patchStoreInfo = internalMutation({
  args: { id: v.id("shopifyConnections"), currency: v.optional(v.string()), locale: v.optional(v.string()) },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch("shopifyConnections", id, patch);
  },
});

export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    shopDomain: v.string(),
    shopName: v.string(),
    accessToken: v.string(),
    currency: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    // A new token for the same store keeps the pages Full store made there.
    const keep = existing?.shopDomain === args.shopDomain && existing.storePages ? { storePages: existing.storePages } : {};
    const row = { ...args, ...keep, connectedAt: new Date().toISOString() };
    if (existing) await ctx.db.replace("shopifyConnections", existing._id, row);
    else await ctx.db.insert("shopifyConnections", row);
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const c = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (c) await ctx.db.delete("shopifyConnections", c._id);
  },
});

export const forPush = internalQuery({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return { error: "Please sign in first." as const };
    const c = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!c) return { error: "Connect your Shopify store first." as const };
    const product = await ctx.db.get("products", args.productId);
    if (!product) return { error: "Product not found." as const };
    return { shopDomain: c.shopDomain, accessToken: c.accessToken, product };
  },
});

const PRODUCT_SET = `mutation AddProduct($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle }
    userErrors { field message }
  }
}`;

export const pushProduct = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<{ adminUrl: string }> => {
    const found = await ctx.runQuery(internal.shopifyImport.forPush, { productId: args.productId });
    if ("error" in found) throw new ConvexError({ code: "BAD_REQUEST", message: found.error });
    const data = (await shopifyGraphql(found.shopDomain, found.accessToken, PRODUCT_SET, { input: productSetInput(found.product) })) as {
      productSet?: { product: { id: string } | null; userErrors: { message: string }[] };
    };
    const errors = data.productSet?.userErrors ?? [];
    if (errors.length || !data.productSet?.product) {
      throw new ConvexError({ code: "SHOPIFY", message: `Shopify: ${errors.map((e) => e.message).join("; ") || "the product wasn't created"}` });
    }
    const numericId = data.productSet.product.id.split("/").pop();
    return { adminUrl: `https://${found.shopDomain}/admin/products/${numericId}` };
  },
});
