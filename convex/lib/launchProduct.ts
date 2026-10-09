// What Launch needs from a product, whether it's in the shared catalog
// (products) or one a user pasted a link to (importedProducts, private to them).

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type LaunchProductId = Id<"products"> | Id<"importedProducts">;

export type Launchable = Pick<Doc<"products">, "title" | "description" | "category" | "imageUrl" | "images" | "price" | "cost" | "supplierMatches" | "adIds" | "isBigBrand"> & {
  /** "imported": pasted by the user, so no ads or catalog data behind it. */
  kind: "catalog" | "imported";
};

/** The product, or null when it's gone or someone else's import. */
export async function getLaunchProduct(ctx: QueryCtx, id: LaunchProductId, userId: Id<"users"> | undefined): Promise<Launchable | null> {
  const catalog = ctx.db.normalizeId("products", id);
  if (catalog) {
    const p = await ctx.db.get("products", catalog);
    return p ? { ...p, kind: "catalog" } : null;
  }
  const imported = ctx.db.normalizeId("importedProducts", id);
  const p = imported ? await ctx.db.get("importedProducts", imported) : null;
  if (!p || p.userId !== userId) return null;
  return {
    kind: "imported",
    title: p.title,
    description: p.description,
    category: p.category,
    imageUrl: p.imageUrl,
    images: p.images,
    ...(p.price !== undefined ? { price: p.price } : {}),
    ...(p.cost !== undefined ? { cost: p.cost } : {}),
  };
}
