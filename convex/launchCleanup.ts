import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { NoAccess, adminGql } from "./lib/shopifyAdmin";
import { decryptToken } from "./lib/shopifyOAuth";

// Deleting launches (Launch page): the rows and their AI photos and ad images,
// the unpublished theme a Full store launch installed (Shopify allows 20; the
// live theme is never touched), and on request the Shopify product, unless a
// launch that stays still uses it. Store pages and menus are shared by every
// Full store launch, so they stay.

const MAX = 50;

export const forCleanup = internalQuery({
  args: { token: v.string(), launchIds: v.array(v.id("launches")) },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const wanted = new Set<string>(args.launchIds);
    const all = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const launches = all.filter((l) => wanted.has(l._id));
    const keptProducts = new Set(all.filter((l) => !wanted.has(l._id) && l.shopifyProductId).map((l) => l.shopifyProductId!));
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    return {
      launches: launches.map((l) => ({
        id: l._id,
        status: l.status,
        shopDomain: l.shopDomain,
        themeId: l.themeId,
        shopifyProductId: l.shopifyProductId,
        productStillUsed: !!l.shopifyProductId && keptProducts.has(l.shopifyProductId),
      })),
      store: store ? { shopDomain: store.shopDomain, accessToken: store.accessToken } : null,
    };
  },
});

export const deleteRows = internalMutation({
  args: { launchIds: v.array(v.id("launches")) },
  handler: async (ctx, args) => {
    for (const id of args.launchIds) {
      const l = await ctx.db.get("launches", id);
      if (!l || l.status === "generating" || l.status === "publishing") continue;
      const files: Id<"_storage">[] = [...(l.aiPhotoIds ?? []), ...(l.adImages ?? []).map((a) => a.id)];
      for (const f of files) await ctx.storage.delete(f).catch(() => {});
      await ctx.db.delete("launches", id);
    }
  },
});

const THEME_ROLE = `query Role($id: ID!) { theme(id: $id) { id role } }`;
const THEME_DELETE = `mutation Del($id: ID!) { themeDelete(id: $id) { deletedThemeId userErrors { message } } }`;
const PRODUCT_DELETE = `mutation Del($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { message } } }`;

export const remove = action({
  args: { launchIds: v.array(v.id("launches")), deleteProducts: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ removed: number; themesDeleted: number; productsDeleted: number; notes: string[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (!args.launchIds.length) return { removed: 0, themesDeleted: 0, productsDeleted: 0, notes: [] };
    if (args.launchIds.length > MAX) throw new ConvexError({ code: "TOO_MANY", message: `Delete at most ${MAX} launches at once.` });
    const c = await ctx.runQuery(internal.launchCleanup.forCleanup, { token: stableToken(identity), launchIds: args.launchIds });
    if (!c) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const busy = c.launches.filter((l) => l.status === "generating" || l.status === "publishing");
    const doomed = c.launches.filter((l) => !busy.includes(l));
    const notes: string[] = [];
    if (busy.length) notes.push(`${busy.length} launch${busy.length === 1 ? " is" : "es are"} still running, so ${busy.length === 1 ? "it was" : "they were"} kept.`);

    let themesDeleted = 0;
    let productsDeleted = 0;
    const inStore = doomed.filter((l) => c.store && l.shopDomain === c.store.shopDomain);
    const needsShopify = inStore.some((l) => l.themeId || (args.deleteProducts && l.shopifyProductId && !l.productStillUsed));
    if (needsShopify && c.store) {
      const shop = c.store.shopDomain;
      const token = await decryptToken(c.store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      for (const l of inStore) {
        try {
          let live = false;
          if (l.themeId) {
            const t = await adminGql<{ theme: { role: string } | null }>(shop, token, THEME_ROLE, { id: l.themeId });
            if (t.theme?.role === "MAIN") {
              live = true;
              notes.push("A store you made live was kept, with its theme and product.");
            } else if (t.theme) {
              const r = await adminGql<{ themeDelete: { deletedThemeId: string | null; userErrors: { message: string }[] } }>(shop, token, THEME_DELETE, { id: l.themeId });
              if (r.themeDelete.deletedThemeId) themesDeleted++;
              else if (r.themeDelete.userErrors.length) notes.push(`A theme couldn't be deleted: ${r.themeDelete.userErrors[0].message}`);
            }
          }
          if (args.deleteProducts && l.shopifyProductId && !l.productStillUsed && !live) {
            const r = await adminGql<{ productDelete: { deletedProductId: string | null; userErrors: { message: string }[] } }>(shop, token, PRODUCT_DELETE, { id: l.shopifyProductId });
            if (r.productDelete.deletedProductId) productsDeleted++;
            else if (r.productDelete.userErrors.length && !/not exist|not found/i.test(r.productDelete.userErrors[0].message)) {
              notes.push(`A product couldn't be deleted: ${r.productDelete.userErrors[0].message}`);
            }
          }
        } catch (e) {
          if (e instanceof NoAccess) notes.push("Shopify didn't allow deleting a theme or product. Reconnect your store in Settings → Shopify.");
          else notes.push(e instanceof Error ? e.message : "Shopify had a problem.");
        }
      }
    }
    if (args.deleteProducts && doomed.some((l) => l.productStillUsed)) notes.push("Products another launch still uses were kept.");
    if (doomed.some((l) => !c.store || l.shopDomain !== c.store.shopDomain) && doomed.some((l) => l.themeId || l.shopifyProductId)) {
      notes.push("Launches for a store that isn't connected now were removed here only; nothing changed in that store.");
    }
    await ctx.runMutation(internal.launchCleanup.deleteRows, { launchIds: doomed.map((l) => l.id) });
    return { removed: doomed.length, themesDeleted, productsDeleted, notes: [...new Set(notes)] };
  },
});
