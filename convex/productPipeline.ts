import { estimateProduct, unitsPerMonthFromText } from "./lib/estimates";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireSignedIn } from "./lib/access";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { markStatsDirty } from "./stats";
import { requireAdmin } from "./admin/helpers";
import { NICHES } from "./lib/category";
import { parseRangeUpperBound } from "./lib/rangeParsing";
import { priceFromAdText, priceLabel, toUsd } from "./lib/priceParse";
import {
  adSellsProduct, gmvFromText, parseCompact, productFlags, productTitleForAd, roundRobin, titleKey, urlKey, isProductPage,
} from "./lib/productMatch";

// ── Daily product pipeline ──────────────────────────────────────────────────
// Runs once a day after the imports (see crons.ts), as a chain of small
// steps so no single function gets large:
//   keys       – matching keys, hide-flags and margin on every product
//   link       – every ad that sells a physical product is attached to one
//                product (matched by landing page, then title; created if new)
//   aggregate  – each product adds up its ads (views, likes, spend, GMV…)
//   winners    – Winning Products: top 50 per niche with score 65+, mixed
//   snapshots  – one history row per product and per ad for today
//   prune      – history older than 90 days is removed
// Progress is kept in siteStats["productPipeline"] for the admin panel.

export const WINNER_MIN_SCORE = 65;
export const WINNERS_PER_NICHE = 50;
const KEEP_DAYS = 90;
const MAX_ADS_PER_PRODUCT = 200;

type Stage = "keys" | "link" | "aggregate" | "winners" | "snapshotProducts" | "snapshotAds" | "prune" | "done";
const NEXT: Record<Stage, Stage> = {
  keys: "link",
  link: "aggregate",
  aggregate: "winners",
  winners: "snapshotProducts",
  snapshotProducts: "snapshotAds",
  snapshotAds: "prune",
  prune: "done",
  done: "done",
};

type Status = {
  state: "running" | "done" | "error";
  stage: Stage;
  day: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  counts: { productsCreated: number; adsLinked: number; winners: number; snapshots: number; pruned: number };
};

const today = () => new Date().toISOString().slice(0, 10);
const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

async function readStatus(ctx: MutationCtx): Promise<{ id: Id<"siteStats">; data: Status } | null> {
  const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
  return doc ? { id: doc._id, data: doc.data as Status } : null;
}

async function writeStatus(ctx: MutationCtx, data: Status) {
  const doc = await readStatus(ctx);
  const updatedAt = new Date().toISOString();
  if (doc) await ctx.db.patch("siteStats", doc.id, { data, updatedAt });
  else await ctx.db.insert("siteStats", { key: "productPipeline", data, updatedAt });
}

async function begin(ctx: MutationCtx): Promise<boolean> {
  const current = await readStatus(ctx);
  // One run at a time; a run stuck for over an hour is considered dead.
  if (current?.data.state === "running" && Date.now() - Date.parse(current.data.startedAt) < 3_600_000) return false;
  const day = today();
  await writeStatus(ctx, {
    state: "running",
    stage: "keys",
    day,
    startedAt: new Date().toISOString(),
    counts: { productsCreated: 0, adsLinked: 0, winners: 0, snapshots: 0, pruned: 0 },
  });
  await ctx.scheduler.runAfter(0, internal.productPipeline.step, { stage: "keys", cursor: null, day });
  return true;
}

export const start = internalMutation({ args: {}, handler: async (ctx) => void (await begin(ctx)) });

export const runNow = mutation({
  args: {},
  handler: async (ctx): Promise<{ started: boolean }> => {
    await requireAdmin(ctx);
    return { started: await begin(ctx) };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const doc = await ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "productPipeline")).unique();
    return (doc?.data as Status | undefined) ?? null;
  },
});

// ── Pure helpers (exported for tests) ──────────────────────────────────────

export function adNumbers(ad: Doc<"ads">) {
  return {
    views: ad.impressions ?? parseCompact(ad.views) ?? 0,
    likes: ad.likes ?? 0,
    comments: ad.comments ?? 0,
    spend: parseRangeUpperBound(ad.spendEstimate ?? "") ?? 0,
    gmv: ad.gmv ?? gmvFromText(ad.bodyText ?? "") ?? 0,
  };
}

function productText(p: Pick<Doc<"products">, "title" | "description" | "tags">) {
  return `${p.title} ${p.description.slice(0, 400)} ${p.tags.join(" ")}`;
}

// ── Steps ───────────────────────────────────────────────────────────────────

export const step = internalMutation({
  args: { stage: v.string(), cursor: v.union(v.string(), v.null()), day: v.string() },
  handler: async (ctx, args) => {
    const stage = args.stage as Stage;
    const status = await readStatus(ctx);
    if (!status || status.data.state !== "running" || status.data.day !== args.day) return; // cancelled or superseded
    const counts = { ...status.data.counts };
    let done = true;
    let cursor: string | null = null;

    try {
      if (stage === "keys") {
        const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: args.cursor });
        for (const p of page.page) {
          const flags = productFlags(productText(p));
          const pageUrl = [p.storeUrl, p.supplierUrl].find((u) => isProductPage(u));
          const margin =
            p.price !== undefined && p.cost !== undefined && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined;
          const next = {
            urlKey: urlKey(pageUrl) ?? undefined,
            titleKey: titleKey(p.title) ?? undefined,
            marginPercent: margin,
            ...flags,
          };
          if ((Object.keys(next) as (keyof typeof next)[]).some((k) => p[k] !== next[k])) await ctx.db.patch("products", p._id, next);
        }
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "link") {
        const page = await ctx.db.query("ads").paginate({ numItems: 150, cursor: args.cursor });
        let created = 0;
        for (const ad of page.page) {
          const r = await linkAd(ctx, ad);
          if (r === "created") created++;
          if (r !== "skipped") counts.adsLinked++;
        }
        counts.productsCreated += created;
        if (created) await markStatsDirty(ctx);
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "aggregate") {
        const page = await ctx.db.query("products").paginate({ numItems: 40, cursor: args.cursor });
        for (const p of page.page) {
          if (p.adIds?.length || p.linkedAds) await aggregate(ctx, p, args.day);
          else await applyEstimates(ctx, p);
        }
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "winners") {
        counts.winners = await rebuildWinners(ctx, args.day);
      } else if (stage === "snapshotProducts") {
        const page = await ctx.db.query("products").paginate({ numItems: 200, cursor: args.cursor });
        for (const p of page.page) {
          await upsertSnapshot(ctx, args.day, "product", p._id, {
            score: p.aiScore,
            adsRunning: p.linkedAds || p.adsCount || 0,
            views: p.linkedViews ?? 0,
            likes: p.likes ?? 0,
            comments: p.linkedComments ?? 0,
            spend: p.linkedSpend ?? 0,
            gmv: p.linkedGmv ?? 0,
            trend: p.trend,
            saturation: p.saturation,
          });
        }
        counts.snapshots += page.page.length;
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "snapshotAds") {
        const page = await ctx.db.query("ads").paginate({ numItems: 200, cursor: args.cursor });
        for (const ad of page.page) {
          await upsertSnapshot(ctx, args.day, "ad", ad._id, { score: ad.aiScore, adsRunning: 1, ...adNumbers(ad) });
        }
        counts.snapshots += page.page.length;
        done = page.isDone;
        cursor = page.continueCursor;
      } else if (stage === "prune") {
        const old = await ctx.db
          .query("dailySnapshots")
          .withIndex("by_day", (q) => q.lt("day", dayMinus(args.day, KEEP_DAYS)))
          .take(1000);
        for (const row of old) await ctx.db.delete("dailySnapshots", row._id);
        counts.pruned += old.length;
        done = old.length < 1000;
      }
    } catch (e) {
      await writeStatus(ctx, {
        ...status.data,
        counts,
        state: "error",
        error: `${stage}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const nextStage = done ? NEXT[stage] : stage;
    if (nextStage === "done") {
      await writeStatus(ctx, { ...status.data, counts, stage: "done", state: "done", finishedAt: new Date().toISOString() });
      // Then look up prices for products that have none (network, so an action).
      await ctx.scheduler.runAfter(0, internal.priceFetch.run, { round: 0 });
      // And the Research tab (trending keywords, niches) from today's data.
      await ctx.scheduler.runAfter(0, internal.research.rebuild, {});
      return;
    }
    await writeStatus(ctx, { ...status.data, counts, stage: nextStage });
    await ctx.scheduler.runAfter(0, internal.productPipeline.step, { stage: nextStage, cursor: done ? null : cursor, day: args.day });
  },
});

async function detach(ctx: MutationCtx, productId: Id<"products">, adId: Id<"ads">) {
  const p = await ctx.db.get("products", productId);
  if (!p?.adIds) return;
  const adIds = p.adIds.filter((id) => id !== adId);
  if (adIds.length !== p.adIds.length) await ctx.db.patch("products", p._id, { adIds, linkedAds: adIds.length });
}

// Attaches one ad to its product. Match order: landing-page URL, then
// normalised product title; otherwise a new product is created.
export async function linkAd(ctx: MutationCtx, ad: Doc<"ads">): Promise<"created" | "linked" | "unchanged" | "skipped"> {
  if (!adSellsProduct(ad)) {
    if (ad.productId) {
      await detach(ctx, ad.productId, ad._id);
      await ctx.db.patch("ads", ad._id, { productId: undefined });
    }
    return "skipped";
  }
  const title = productTitleForAd(ad);
  const uk = urlKey(ad.landingPageUrl);
  const tk = titleKey(title);

  let product: Doc<"products"> | null = null;
  if (uk) product = await ctx.db.query("products").withIndex("by_url_key", (q) => q.eq("urlKey", uk)).first();
  if (!product && tk) product = await ctx.db.query("products").withIndex("by_title_key", (q) => q.eq("titleKey", tk)).first();

  let outcome: "created" | "linked" | "unchanged" = "linked";
  if (!product) {
    const flags = productFlags(`${title} ${ad.bodyText.slice(0, 300)}`);
    const id = await ctx.db.insert("products", {
      title,
      description: `Found in ${ad.platform} ads by ${ad.advertiserName}. ${ad.bodyText}`.trim().slice(0, 500),
      imageUrl: ad.creativeUrl,
      category: ad.niche,
      tags: [ad.niche, ad.platform, "from ads"],
      aiScore: ad.aiScore,
      saturation: "Unknown",
      trend: "Unknown",
      supplierUrl: ad.landingPageUrl,
      storeUrl: ad.landingPageUrl,
      adExamples: [],
      isWinnerOfDay: false,
      publishedAt: new Date().toISOString(),
      source: "ads",
      urlKey: uk ?? undefined,
      titleKey: tk ?? undefined,
      adIds: [ad._id],
      linkedAds: 1,
      ...flags,
    });
    product = (await ctx.db.get("products", id))!;
    outcome = "created";
  } else if (ad.productId === product._id && product.adIds?.includes(ad._id)) {
    return "unchanged";
  } else if (!product.adIds?.includes(ad._id)) {
    const adIds = [...(product.adIds ?? []), ad._id].slice(-MAX_ADS_PER_PRODUCT);
    await ctx.db.patch("products", product._id, { adIds, linkedAds: adIds.length });
  }

  if (ad.productId && ad.productId !== product._id) await detach(ctx, ad.productId, ad._id);
  if (ad.productId !== product._id) await ctx.db.patch("ads", ad._id, { productId: product._id });
  return outcome;
}

// Adds up a product's ads. Products that exist only because of ads ("ads"
// source) also take their score, likes, image and trend from them.
export async function aggregate(ctx: MutationCtx, p: Doc<"products">, day: string) {
  const ads = (await Promise.all((p.adIds ?? []).map((id) => ctx.db.get("ads", id)))).filter(
    (a): a is Doc<"ads"> => !!a && a.productId === p._id,
  );
  if (ads.length === 0 && p.source === "ads") {
    const saved = await ctx.db.query("savedProducts").withIndex("by_product", (q) => q.eq("productId", p._id)).first();
    if (!saved) {
      await ctx.db.delete("products", p._id);
      await markStatsDirty(ctx);
      return;
    }
  }
  const sum = { views: 0, likes: 0, comments: 0, spend: 0, gmv: 0 };
  let best = 0;
  for (const ad of ads) {
    const n = adNumbers(ad);
    sum.views += n.views;
    sum.likes += n.likes;
    sum.comments += n.comments;
    sum.spend += n.spend;
    sum.gmv += n.gmv;
    best = Math.max(best, ad.aiScore);
  }
  const patch: Partial<Doc<"products">> = {
    adIds: ads.map((a) => a._id),
    linkedAds: ads.length,
    linkedViews: sum.views,
    linkedComments: sum.comments,
    linkedSpend: sum.spend,
    linkedGmv: sum.gmv,
  };
  // A price an import wrote into the ad text ("Product Price: $12.61").
  if (p.price === undefined) {
    for (const ad of ads) {
      const found = priceFromAdText(ad.bodyText ?? "");
      const usd = found ? toUsd(found) : undefined;
      if (found && usd !== undefined) {
        patch.price = usd;
        patch.priceSource = "ad_data";
        patch.originalPrice = priceLabel(found);
        break;
      }
    }
  }
  // "Ads running" (sort and filter) counts linked ads too.
  if (ads.length > (p.adsCount ?? 0) || p.source === "ads") patch.adsCount = ads.length;
  if (p.source === "ads" && ads.length) {
    // More ads for the same product = the seller is scaling it.
    patch.aiScore = Math.min(100, best + 3 * (ads.length - 1));
    patch.likes = sum.likes;
    if (!p.imageUrl) patch.imageUrl = ads.find((a) => a.creativeUrl)?.creativeUrl ?? "";
    const weekAgo = await ctx.db
      .query("dailySnapshots")
      .withIndex("by_entity_day", (q) => q.eq("kind", "product").eq("entityId", p._id).eq("day", dayMinus(day, 7)))
      .unique();
    if (weekAgo && weekAgo.views > 0) {
      const growth = (sum.views - weekAgo.views) / weekAgo.views;
      patch.trend = growth >= 0.2 ? "Rising" : growth >= 0.02 ? "Stable" : "Declining";
      patch.growthPercent = Math.round(growth * 1000) / 10;
    }
  }
  await ctx.db.patch("products", p._id, { ...patch, ...estimatesFor({ ...p, ...patch }, sum) });
}

// Modelled impressions / ad spend / monthly revenue (lib/estimates.ts) from
// what the product has: its ads' numbers, marketplace sales, price, likes.
function estimatesFor(
  p: Doc<"products">,
  ads?: { views: number; likes: number; comments: number; spend: number; gmv: number },
): Partial<Doc<"products">> {
  const units = p.unitsPerMonth ?? unitsPerMonthFromText(p.description ?? "");
  const e = estimateProduct({
    price: p.price,
    views: ads?.views ?? p.linkedViews,
    likes: ads?.likes ?? p.likes,
    comments: ads?.comments ?? p.linkedComments,
    spend: ads?.spend ?? p.linkedSpend,
    gmv: ads?.gmv ?? p.linkedGmv,
    unitsPerMonth: units,
  });
  return {
    ...(units !== undefined ? { unitsPerMonth: units } : {}),
    estImpressions: e.impressions,
    estAdSpend: e.adSpend,
    estRevenue: e.revenue,
    estBasis: { impressions: e.impressionsBasis, adSpend: e.adSpendBasis, revenue: e.revenueBasis },
  };
}

async function applyEstimates(ctx: MutationCtx, p: Doc<"products">) {
  const patch = estimatesFor(p);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (same(patch.estImpressions, p.estImpressions) && same(patch.estRevenue, p.estRevenue) && same(patch.estAdSpend, p.estAdSpend) && same(patch.unitsPerMonth, p.unitsPerMonth)) return;
  await ctx.db.patch("products", p._id, patch);
}

// Winning Products: per niche, the top 50 by score (65+), without big
// brands, personalised / print-on-demand items and services; then dealt out
// round-robin so the feed alternates niches. Never padded with weaker ones.
export async function rebuildWinners(ctx: MutationCtx, day: string): Promise<number> {
  const perNiche: { niche: string; products: Doc<"products">[] }[] = [];
  for (const niche of NICHES) {
    const top: Doc<"products">[] = [];
    const candidates = ctx.db
      .query("products")
      .withIndex("by_category_score", (q) => q.eq("category", niche).gte("aiScore", WINNER_MIN_SCORE))
      .order("desc");
    for await (const p of candidates) {
      if (p.isBigBrand || p.isPersonalised || p.isService || !p.imageUrl) continue;
      top.push(p);
      if (top.length >= WINNERS_PER_NICHE) break;
    }
    if (top.length) perNiche.push({ niche, products: top });
  }
  perNiche.sort((a, b) => b.products[0].aiScore - a.products[0].aiScore);
  const feed = roundRobin(perNiche.map((n) => n.products.map((p, i) => ({ p, niche: n.niche, rank: i + 1 }))));

  const previous = await ctx.db.query("winningProducts").collect();
  const enteredBefore = new Map(previous.map((r) => [r.productId as string, r.enteredDay]));
  const keep = new Set(feed.map((f) => f.p._id as string));
  for (const r of previous) {
    await ctx.db.delete("winningProducts", r._id);
    if (!keep.has(r.productId)) {
      const p = await ctx.db.get("products", r.productId);
      if (p?.winnerRank !== undefined) await ctx.db.patch("products", p._id, { winnerRank: undefined });
    }
  }
  for (const [position, f] of feed.entries()) {
    await ctx.db.insert("winningProducts", {
      productId: f.p._id,
      niche: f.niche,
      nicheRank: f.rank,
      position,
      score: f.p.aiScore,
      enteredDay: enteredBefore.get(f.p._id) ?? day,
    });
    if (f.p.winnerRank !== f.rank) await ctx.db.patch("products", f.p._id, { winnerRank: f.rank });
  }
  return feed.length;
}

type SnapshotValues = Omit<Doc<"dailySnapshots">, "_id" | "_creationTime" | "day" | "kind" | "entityId">;

async function upsertSnapshot(ctx: MutationCtx, day: string, kind: "product" | "ad", entityId: string, values: SnapshotValues) {
  const row = await ctx.db
    .query("dailySnapshots")
    .withIndex("by_entity_day", (q) => q.eq("kind", kind).eq("entityId", entityId).eq("day", day))
    .unique();
  if (row) await ctx.db.patch("dailySnapshots", row._id, values);
  else await ctx.db.insert("dailySnapshots", { day, kind, entityId, ...values });
}
