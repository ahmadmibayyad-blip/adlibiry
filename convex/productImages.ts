import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { cleanImages, imagesFromHtml, imagesFromShopifyJs, shopifyJsUrl } from "./lib/productImages";
import { requireSignedIn } from "./lib/access";

// More photos for a product: read once from its store page when someone opens
// the product (re-checked after 7 days). Only the product's own stored link is
// fetched. Parsing: convex/lib/productImages.ts.

const RECHECK_MS = 7 * 86_400_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

async function get(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" }, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const forImages = internalQuery({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("products", args.productId);
    if (!p) return null;
    const pageUrl = [p.storeUrl, p.supplierUrl].find(
      (u) => u && /^https?:\/\//.test(u) && !/aliexpress\.com\/wholesale|\/s\?k=|google\.com\/search/i.test(u),
    );
    return { pageUrl: pageUrl ?? null, imageUrl: p.imageUrl, checkedAt: p.imagesCheckedAt ?? null };
  },
});

export const save = internalMutation({
  args: { productId: v.id("products"), images: v.array(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch("products", args.productId, { images: args.images, imagesCheckedAt: new Date().toISOString() });
  },
});

export const load = action({
  args: { productId: v.id("products") },
  handler: async (ctx, args): Promise<number> => {
    await requireSignedIn(ctx);
    const p = await ctx.runQuery(internal.productImages.forImages, { productId: args.productId });
    if (!p || (p.checkedAt && Date.now() - Date.parse(p.checkedAt) < RECHECK_MS)) return 0;
    let found: string[] = [];
    if (p.pageUrl) {
      const js = shopifyJsUrl(p.pageUrl);
      if (js) {
        const res = await get(js, "application/json");
        if (res?.ok) found = imagesFromShopifyJs(await res.json().catch(() => null), p.pageUrl);
      }
      if (!found.length) {
        const res = await get(p.pageUrl, "text/html");
        if (res?.ok) found = imagesFromHtml(await res.text(), p.pageUrl);
      }
    }
    const images = cleanImages(found, p.imageUrl);
    await ctx.runMutation(internal.productImages.save, { productId: args.productId, images });
    return images.length;
  },
});
