import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { resultLimitFor } from "./lib/access";
import { isSameImage } from "./lib/imageHash";
import { SIMILAR_SHOWN, VOYAGE_MODEL, pickSimilar } from "./lib/adEmbeddings";

// "Looks similar" ads. The daily job (adEmbeddingsAction.ts, importRuns job
// "adEmbeddings") turns ad images into vectors stored here; looksSimilar finds
// an ad's nearest images with the vector index. Vector search only runs in
// actions, so the lookup is an action and the reads are internal queries.

// Ads not handled yet, newest first.
export const nextToEmbed = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const ads = await ctx.db
      .query("ads")
      .withIndex("by_embed_status", (q) => q.eq("embedStatus", undefined))
      .order("desc")
      .take(args.limit);
    return ads.map((a) => ({ id: a._id, url: a.creativeUrl, imageHash: a.imageHash, niche: a.niche }));
  },
});

export const saveEmbeddings = internalMutation({
  args: {
    done: v.array(v.object({ id: v.id("ads"), embedding: v.array(v.float64()) })),
    none: v.array(v.id("ads")),
    failed: v.array(v.id("ads")),
  },
  handler: async (ctx, args) => {
    for (const d of args.done) {
      const ad = await ctx.db.get("ads", d.id);
      if (!ad) continue;
      const row = { adId: d.id, embedding: d.embedding, niche: ad.niche, model: VOYAGE_MODEL };
      const existing = await ctx.db.query("adEmbeddings").withIndex("by_ad", (q) => q.eq("adId", d.id)).first();
      if (existing) await ctx.db.replace("adEmbeddings", existing._id, row);
      else await ctx.db.insert("adEmbeddings", row);
      await ctx.db.patch("ads", d.id, { embedStatus: "done" });
    }
    for (const id of args.none) if (await ctx.db.get("ads", id)) await ctx.db.patch("ads", id, { embedStatus: "none" });
    for (const id of args.failed) if (await ctx.db.get("ads", id)) await ctx.db.patch("ads", id, { embedStatus: "failed" });
  },
});

export const embeddingFor = internalQuery({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.adId);
    if (!ad) return null;
    const row = await ctx.db.query("adEmbeddings").withIndex("by_ad", (q) => q.eq("adId", args.adId)).first();
    return { status: ad.embedStatus, embedding: row?.embedding ?? null };
  },
});

// The ads behind vector-search hits, best first, and how many this user may see.
export const hitsToAds = internalQuery({
  args: { adId: v.id("ads"), hits: v.array(v.object({ id: v.id("adEmbeddings"), score: v.number() })) },
  handler: async (ctx, args) => {
    const self = await ctx.db.get("ads", args.adId);
    const out: { ad: Doc<"ads">; score: number; sameImage: boolean; self: boolean }[] = [];
    for (const h of args.hits) {
      const row = await ctx.db.get("adEmbeddings", h.id);
      const ad = row && (await ctx.db.get("ads", row.adId));
      if (!ad) continue; // ad removed since it was embedded
      out.push({ ad, score: h.score, self: ad._id === args.adId, sameImage: isSameImage(ad.imageHash, self?.imageHash) });
    }
    return { hits: out, limit: await resultLimitFor(ctx) };
  },
});

type Similar = {
  status: "ok" | "pending" | "none" | "failed";
  ads: (Doc<"ads"> & { score: number })[];
};

/** Ads whose image looks like this ad's (not identical copies: those are ads.sameCreative). */
export const looksSimilar = action({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<Similar | null> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to see this." });
    const mine = await ctx.runQuery(internal.adEmbeddings.embeddingFor, { adId: args.adId });
    if (!mine) return null;
    if (!mine.embedding) {
      const status = mine.status === "none" || mine.status === "failed" ? mine.status : "pending";
      return { status, ads: [] };
    }
    // Extra hits so filtering out copies and capping per advertiser still leaves enough.
    const hits = await ctx.vectorSearch("adEmbeddings", "by_embedding", { vector: mine.embedding, limit: 64 });
    const { hits: loaded, limit } = await ctx.runQuery(internal.adEmbeddings.hitsToAds, {
      adId: args.adId,
      hits: hits.map((h) => ({ id: h._id as Id<"adEmbeddings">, score: h._score })),
    });
    const picked = pickSimilar(loaded, Math.min(SIMILAR_SHOWN, limit ?? SIMILAR_SHOWN));
    return { status: "ok", ads: picked.map((p) => ({ ...p.ad, score: p.score })) };
  },
});
