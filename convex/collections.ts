import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";

// ── Named collections ───────────────────────────────────────────────────────
// The user's own folders ("Pet winners", "Test next week") holding ads,
// stores and products side by side. Separate from the one-click Save
// (savedAds/savedProducts) and the store watchlist (trackedStores): adding to
// a collection changes neither. Free for every signed-in user.

export const MAX_COLLECTIONS = 50;
export const MAX_ITEMS = 500;
const NAME_MAX = 60;
const COVERS = 3;
const SHOWN_ITEMS = 200;

const kind = v.union(v.literal("ad"), v.literal("store"), v.literal("product"));
type Kind = "ad" | "store" | "product";

async function currentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity)))
    .unique();
}

async function requireUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to use collections." });
  return user;
}

async function ownCollection(ctx: MutationCtx, user: Doc<"users">, id: Id<"collections">): Promise<Doc<"collections">> {
  const c = await ctx.db.get("collections", id);
  if (!c || c.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Collection not found." });
  return c;
}

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new ConvexError({ code: "BAD_REQUEST", message: "Give the collection a name." });
  if (name.length > NAME_MAX) throw new ConvexError({ code: "BAD_REQUEST", message: `Keep the name under ${NAME_MAX} characters.` });
  return name;
}

async function nameTaken(ctx: QueryCtx, userId: Id<"users">, name: string, except?: Id<"collections">) {
  const mine = await ctx.db.query("collections").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_COLLECTIONS);
  return mine.some((c) => c._id !== except && c.name.toLowerCase() === name.toLowerCase());
}

// The ad, store or product an item points to, or null once it's gone.
async function resolve(ctx: QueryCtx, k: Kind, refId: string): Promise<Doc<"ads"> | Doc<"stores"> | Doc<"products"> | null> {
  if (k === "ad") {
    const id = ctx.db.normalizeId("ads", refId);
    return id ? await ctx.db.get("ads", id) : null;
  }
  if (k === "store") {
    const id = ctx.db.normalizeId("stores", refId);
    return id ? await ctx.db.get("stores", id) : null;
  }
  const id = ctx.db.normalizeId("products", refId);
  return id ? await ctx.db.get("products", id) : null;
}

function thumbOf(k: Kind, doc: Doc<"ads"> | Doc<"stores"> | Doc<"products">): string | null {
  if (k === "ad") {
    const ad = doc as Doc<"ads">;
    return ad.hostedImageUrl || ad.creativeUrl || null;
  }
  if (k === "store") {
    const s = doc as Doc<"stores">;
    const icon = !s.logoUrl || s.logoUrl.includes("google.com/s2/favicons");
    return (icon && s.bestSellers.find((b) => b.imageUrl)?.imageUrl) || s.logoUrl || null;
  }
  return (doc as Doc<"products">).imageUrl || null;
}

async function addItem(ctx: MutationCtx, user: Doc<"users">, c: Doc<"collections">, k: Kind, refId: string) {
  if (c.itemCount >= MAX_ITEMS) {
    throw new ConvexError({ code: "LIMIT", message: `A collection holds up to ${MAX_ITEMS} items. Start a new one.` });
  }
  const now = new Date().toISOString();
  await ctx.db.insert("collectionItems", { collectionId: c._id, userId: user._id, kind: k, refId, addedAt: now });
  await ctx.db.patch("collections", c._id, { itemCount: c.itemCount + 1, updatedAt: now });
  // Keep our own copy of the ad's image and video, like a saved ad, so it doesn't go blank later.
  if (k === "ad") await ctx.scheduler.runAfter(0, internal.adMediaAction.hostSaved, { adId: refId as Id<"ads"> });
}

// My collections, newest activity first. With `kind` + `refId`, each one also
// says whether that ad/store/product is in it (for the "Add to collection" menu).
export const mine = query({
  args: { kind: v.optional(kind), refId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const list = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_COLLECTIONS);
    const holding = new Set<string>();
    if (args.kind && args.refId) {
      const { kind: k, refId } = args;
      const rows = await ctx.db
        .query("collectionItems")
        .withIndex("by_user_ref", (q) => q.eq("userId", user._id).eq("kind", k).eq("refId", refId))
        .take(MAX_COLLECTIONS);
      for (const r of rows) holding.add(r.collectionId);
    }
    return await Promise.all(
      list.map(async (c) => {
        const newest = await ctx.db
          .query("collectionItems")
          .withIndex("by_collection", (q) => q.eq("collectionId", c._id))
          .order("desc")
          .take(COVERS);
        const covers: string[] = [];
        for (const it of newest) {
          const doc = await resolve(ctx, it.kind as Kind, it.refId);
          const thumb = doc && thumbOf(it.kind as Kind, doc);
          if (thumb) covers.push(thumb);
        }
        return { _id: c._id, name: c.name, itemCount: c.itemCount, updatedAt: c.updatedAt, covers, has: holding.has(c._id) };
      }),
    );
  },
});

// One collection with its newest items, split by kind. Items whose ad, store
// or product was removed from AdSpy Pro are counted in `gone`.
export const get = query({
  args: { id: v.id("collections") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const c = await ctx.db.get("collections", args.id);
    if (!c || c.userId !== user._id) return null;
    const rows = await ctx.db
      .query("collectionItems")
      .withIndex("by_collection", (q) => q.eq("collectionId", c._id))
      .order("desc")
      .take(SHOWN_ITEMS);
    const ads: Doc<"ads">[] = [];
    const stores: Doc<"stores">[] = [];
    const products: Doc<"products">[] = [];
    let gone = 0;
    for (const r of rows) {
      const doc = await resolve(ctx, r.kind as Kind, r.refId);
      if (!doc) gone++;
      else if (r.kind === "ad") ads.push(doc as Doc<"ads">);
      else if (r.kind === "store") stores.push(doc as Doc<"stores">);
      else products.push(doc as Doc<"products">);
    }
    return { _id: c._id, name: c.name, itemCount: c.itemCount, ads, stores, products, gone, more: c.itemCount > rows.length };
  },
});

// New collection; with `item`, that ad/store/product goes straight into it.
export const create = mutation({
  args: { name: v.string(), item: v.optional(v.object({ kind, refId: v.string() })) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = cleanName(args.name);
    const count = (await ctx.db.query("collections").withIndex("by_user", (q) => q.eq("userId", user._id)).take(MAX_COLLECTIONS)).length;
    if (count >= MAX_COLLECTIONS) {
      throw new ConvexError({ code: "LIMIT", message: `You can have up to ${MAX_COLLECTIONS} collections. Delete one first.` });
    }
    if (await nameTaken(ctx, user._id, name)) throw new ConvexError({ code: "BAD_REQUEST", message: `You already have a collection called "${name}".` });
    if (args.item && !(await resolve(ctx, args.item.kind, args.item.refId))) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That item no longer exists." });
    }
    const now = new Date().toISOString();
    const id = await ctx.db.insert("collections", { userId: user._id, name, itemCount: 0, createdAt: now, updatedAt: now });
    if (args.item) await addItem(ctx, user, (await ctx.db.get("collections", id))!, args.item.kind, args.item.refId);
    return id;
  },
});

export const rename = mutation({
  args: { id: v.id("collections"), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ownCollection(ctx, user, args.id);
    const name = cleanName(args.name);
    if (await nameTaken(ctx, user._id, name, args.id)) throw new ConvexError({ code: "BAD_REQUEST", message: `You already have a collection called "${name}".` });
    await ctx.db.patch("collections", args.id, { name });
  },
});

// Deletes the collection and its item rows. The ads, stores and products themselves stay.
export const remove = mutation({
  args: { id: v.id("collections") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ownCollection(ctx, user, args.id);
    const rows = await ctx.db.query("collectionItems").withIndex("by_collection", (q) => q.eq("collectionId", args.id)).take(MAX_ITEMS + 50);
    for (const r of rows) await ctx.db.delete("collectionItems", r._id);
    await ctx.db.delete("collections", args.id);
  },
});

// Adds the item to the collection, or takes it out if it's already there.
export const toggleItem = mutation({
  args: { id: v.id("collections"), kind, refId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const c = await ownCollection(ctx, user, args.id);
    const inIt = (
      await ctx.db
        .query("collectionItems")
        .withIndex("by_user_ref", (q) => q.eq("userId", user._id).eq("kind", args.kind).eq("refId", args.refId))
        .take(MAX_COLLECTIONS)
    ).find((r) => r.collectionId === c._id);
    if (inIt) {
      await ctx.db.delete("collectionItems", inIt._id);
      await ctx.db.patch("collections", c._id, { itemCount: Math.max(0, c.itemCount - 1), updatedAt: new Date().toISOString() });
      return { added: false };
    }
    if (!(await resolve(ctx, args.kind, args.refId))) throw new ConvexError({ code: "NOT_FOUND", message: "That item no longer exists." });
    await addItem(ctx, user, c, args.kind, args.refId);
    return { added: true };
  },
});

// Product merges (convex/productPipeline.ts) point collection items from the
// removed duplicate at the product that stays.
export async function moveProductItems(ctx: MutationCtx, from: Id<"products">, to: Id<"products">) {
  const rows = await ctx.db.query("collectionItems").withIndex("by_ref", (q) => q.eq("kind", "product").eq("refId", from)).take(1000);
  for (const r of rows) {
    const dupe = await ctx.db
      .query("collectionItems")
      .withIndex("by_user_ref", (q) => q.eq("userId", r.userId).eq("kind", "product").eq("refId", to))
      .take(MAX_COLLECTIONS);
    if (dupe.some((d) => d.collectionId === r.collectionId)) {
      await ctx.db.delete("collectionItems", r._id);
      const c = await ctx.db.get("collections", r.collectionId);
      if (c) await ctx.db.patch("collections", c._id, { itemCount: Math.max(0, c.itemCount - 1) });
    } else {
      await ctx.db.patch("collectionItems", r._id, { refId: to });
    }
  }
}

export async function inAnyCollection(ctx: QueryCtx, k: Kind, refId: string): Promise<boolean> {
  return !!(await ctx.db.query("collectionItems").withIndex("by_ref", (q) => q.eq("kind", k).eq("refId", refId)).first());
}
