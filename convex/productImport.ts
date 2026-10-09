import { ConvexError, v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { ALIEXPRESS_ENDPOINT, signParams } from "./lib/aliexpress";
import { classifyNiche } from "./lib/category";
import { fromAliExpressApi, fromAliExpressHtml, fromApifyAliExpress, fromProductHtml, fromShopifyJs, importSource, productUrl, type ImportedProduct } from "./lib/productImport";
import { aliexpressId } from "./lib/supplierReviews";
import { shopifyJsUrl } from "./lib/productImages";

// Launch from any link: reads a product page (AliExpress, a Shopify store or
// any shop; parsing in lib/productImport.ts) into importedProducts, private to
// the user, so it can be launched like a catalog product.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** Price and photos from the AliExpress Affiliate API, when it's set up. */
async function aliexpressDetail(id: string): Promise<ReturnType<typeof fromAliExpressApi>> {
  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
  const secret = process.env.ALIEXPRESS_APP_SECRET?.trim();
  if (!appKey || !secret) return null;
  const params: Record<string, string> = {
    method: "aliexpress.affiliate.productdetail.get",
    app_key: appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    product_ids: id,
    target_currency: "USD",
    target_language: "EN",
    ...(process.env.ALIEXPRESS_TRACKING_ID ? { tracking_id: process.env.ALIEXPRESS_TRACKING_ID } : {}),
  };
  try {
    params.sign = await signParams(params, secret);
    const res = await fetch(ALIEXPRESS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
    });
    return fromAliExpressApi(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

/**
 * An AliExpress product through an Apify reader (residential proxies): AliExpress shows servers a bot
 * check instead of the product, so this is the fallback when the API isn't set up and the page can't be read.
 */
async function aliexpressViaApify(url: string): Promise<ReturnType<typeof fromApifyAliExpress>> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;
  const actor = (process.env.ALIEXPRESS_IMPORT_ACTOR?.trim() || "zen-studio/aliexpress-scraper").replace("/", "~");
  // About $0.06 a product (a $0.05 start plus the product and its details), capped at $0.10.
  const q = new URLSearchParams({ token, timeout: "120", maxTotalChargeUsd: "0.1" });
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productUrls: [url],
        maxResults: 1,
        country: "US",
        currency: "USD",
        language: "en_US",
        includeProductDetails: true,
        includeDescription: false,
        includeReviews: false,
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!res.ok) {
      console.warn("Import: Apify AliExpress reader", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return fromApifyAliExpress(await res.json().catch(() => null));
  } catch (e) {
    console.warn("Import: Apify AliExpress reader failed", e);
    return null;
  }
}

async function readProduct(u: URL): Promise<ImportedProduct | null> {
  const url = u.toString();
  const source = importSource(u);
  if (source === "shopify") {
    const res = await get(shopifyJsUrl(url)!, "application/json");
    const cart = await get(`${u.origin}/cart.js`, "application/json");
    const currency = ((await cart?.json().catch(() => null)) as { currency?: string } | null)?.currency;
    const p = res ? fromShopifyJs(await res.json().catch(() => null), url, currency) : null;
    if (p) return p;
  }
  const page = await get(url, "text/html");
  const html = page ? (await page.text()).slice(0, 2_000_000) : "";
  if (source === "aliexpress") {
    const p = html ? fromAliExpressHtml(html) : null;
    const id = aliexpressId(url);
    let api = id ? await aliexpressDetail(id) : null;
    // From a server the page is usually a bot check: read it through Apify instead.
    if (!p && !api?.title) {
      if (!html) console.warn("Import: AliExpress page didn't load", url);
      else console.warn("Import: AliExpress page had no product (bot check?)", html.length);
      api = await aliexpressViaApify(id ? `https://www.aliexpress.com/item/${id}.html` : url);
    }
    if (!p && !api?.title) return null;
    const images = [...new Set([...(p ? [p.imageUrl, ...p.images] : []), ...(api?.images ?? [])].filter(Boolean))].slice(0, 12);
    return {
      source: "aliexpress",
      title: p?.title || api?.title || "",
      description: "",
      imageUrl: images[0] ?? "",
      images: images.slice(1),
      ...(api?.cost ? { cost: api.cost } : {}),
    };
  }
  return html ? fromProductHtml(html, url) : null;
}

export const save = internalMutation({
  args: {
    token: v.string(),
    url: v.string(),
    product: v.object({
      source: v.string(),
      title: v.string(),
      description: v.string(),
      imageUrl: v.string(),
      images: v.array(v.string()),
      price: v.optional(v.number()),
      cost: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<Id<"importedProducts"> | null> => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const row = {
      ...args.product,
      category: classifyNiche({ title: args.product.title, body: args.product.description, url: args.url }, "Other"),
      createdAt: new Date().toISOString(),
    };
    const existing = await ctx.db.query("importedProducts").withIndex("by_user_url", (q) => q.eq("userId", user._id).eq("url", args.url)).unique();
    if (existing) {
      await ctx.db.replace("importedProducts", existing._id, { userId: user._id, url: args.url, ...row });
      return existing._id;
    }
    return ctx.db.insert("importedProducts", { userId: user._id, url: args.url, ...row });
  },
});

export const importLink = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<{ productId: Id<"importedProducts">; title: string; imageUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const u = productUrl(args.url);
    if (!u) throw new ConvexError({ code: "BAD_LINK", message: "Paste the link of a product page, starting with https://" });
    const product = await readProduct(u);
    if (!product) {
      throw new ConvexError({ code: "NOT_A_PRODUCT", message: "We couldn't read a product on that page. Paste the link of the product page itself (AliExpress, a Shopify store or another shop)." });
    }
    const url = u.toString();
    const productId = await ctx.runMutation(internal.productImport.save, { token: stableToken(identity), url, product });
    if (!productId) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    return { productId, title: product.title, imageUrl: product.imageUrl };
  },
});
