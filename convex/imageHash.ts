import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ADS_PER_ROUND, PRODUCTS_PER_ROUND, productHashFields } from "./lib/imageHash";

// Reads and writes for image hashing; the fetching is in imageHashAction.ts
// (Node). Products are scanned page by page because a hash goes stale when
// imageUrl changes; ads are found by their missing hash.

export const nextBatch = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), productsDone: v.boolean() },
  handler: async (ctx, args) => {
    let products: { id: Id<"products">; url: string }[] = [];
    let cursor = args.cursor;
    let productsDone = args.productsDone;
    if (!productsDone) {
      const page = await ctx.db.query("products").paginate({ numItems: PRODUCTS_PER_ROUND, cursor: args.cursor });
      products = page.page.filter((p) => p.imageUrl && p.imageHashUrl !== p.imageUrl).map((p) => ({ id: p._id, url: p.imageUrl }));
      cursor = page.continueCursor;
      productsDone = page.isDone;
    }
    const ads = await ctx.db
      .query("ads")
      .withIndex("by_image_hash", (q) => q.eq("imageHash", undefined))
      .take(ADS_PER_ROUND);
    return { products, ads: ads.map((a) => ({ id: a._id, url: a.creativeUrl })), cursor, productsDone };
  },
});

export const saveHashes = internalMutation({
  args: {
    products: v.array(v.object({ id: v.id("products"), url: v.string(), hash: v.string() })),
    ads: v.array(v.object({ id: v.id("ads"), hash: v.string() })),
  },
  handler: async (ctx, args) => {
    for (const p of args.products) {
      const current = await ctx.db.get("products", p.id);
      // Skip if the product was deleted or got a new image while we were fetching.
      if (current?.imageUrl === p.url) await ctx.db.patch("products", p.id, productHashFields(p.hash, p.url));
    }
    for (const a of args.ads) {
      if (await ctx.db.get("ads", a.id)) await ctx.db.patch("ads", a.id, { imageHash: a.hash });
    }
  },
});
