import { markStatsDirty } from "../stats";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAdmin } from "./helpers";
import { internal } from "../_generated/api";

// ── Admin: Winning Products management ──────────────────────────────────────

export const listProducts = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const result = await ctx.db.query("products").withIndex("by_published").order("desc").paginate(args.paginationOpts);
    let page = result.page;
    if (args.search) {
      const term = args.search.toLowerCase();
      page = page.filter((p) => p.title.toLowerCase().includes(term) || p.category.toLowerCase().includes(term));
    }
    return { ...result, page };
  },
});

const productFields = {
  title: v.string(),
  description: v.string(),
  imageUrl: v.string(),
  price: v.number(),
  cost: v.number(),
  category: v.string(),
  tags: v.array(v.string()),
  aiScore: v.number(),
  saturation: v.string(),
  trend: v.string(),
  supplierUrl: v.string(),
  isWinnerOfDay: v.boolean(),
};

export const createProduct = mutation({
  args: productFields,
  handler: async (ctx, args): Promise<Id<"products">> => {
    await requireAdmin(ctx);
    if (args.aiScore < 0 || args.aiScore > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "AI score must be between 0 and 100" });
    }
    await markStatsDirty(ctx);
    const productId = await ctx.db.insert("products", {
      ...args,
      adExamples: [],
      publishedAt: new Date().toISOString(),
    });

    if (args.isWinnerOfDay) {
      await ctx.scheduler.runAfter(0, internal.notifications.notifyAllForNewWinner, {
        title: "New winning product spotted",
        body: `${args.title} was just added to Winning Products.`,
        link: `/dashboard/products/${productId}`,
      });
    }

    return productId;
  },
});

export const updateProduct = mutation({
  args: { id: v.id("products"), ...productFields },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { id, ...fields } = args;
    if (fields.aiScore < 0 || fields.aiScore > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "AI score must be between 0 and 100" });
    }
    const existing = await ctx.db.get("products", id);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found" });
    await ctx.db.patch("products", id, fields);
    return { success: true };
  },
});

export const deleteProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.get("products", args.id);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found" });
    await markStatsDirty(ctx);
    await ctx.db.delete("products", args.id);
    return { success: true };
  },
});

// Proxy "engagement" metric since we don't track page views: most-saved products.
export const getMostSavedProducts = query({
  args: {},
  handler: async (ctx): Promise<Array<{ product: Doc<"products">; saveCount: number }>> => {
    await requireAdmin(ctx);
    const saved = await ctx.db.query("savedProducts").take(2000);
    const counts = new Map<Id<"products">, number>();
    for (const s of saved) {
      counts.set(s.productId, (counts.get(s.productId) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const products = await Promise.all(
      sorted.map(async ([productId, count]) => {
        const product = await ctx.db.get("products", productId);
        return product ? { product, saveCount: count } : null;
      })
    );
    return products.filter((p): p is { product: Doc<"products">; saveCount: number } => p !== null);
  },
});
