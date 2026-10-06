import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isFetchableUrl, priceFromHtml, priceLabel, toUsd } from "./lib/priceParse";

// ── Prices from product pages ───────────────────────────────────────────────
// Products found in ads have no price. After the daily product pipeline,
// this visits each unpriced product's page and reads the price the store
// publishes (see lib/priceParse.ts). A product is re-tried at most once a
// week; up to 200 pages a day, 5 at a time, each capped at 8 s and 1.5 MB.

const BATCH = 25;
const MAX_ROUNDS = 8;
const RETRY_AFTER_MS = 7 * 86_400_000;
const MAX_BYTES = 1_500_000;

export const candidates = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
    const out: { id: Id<"products">; url: string }[] = [];
    const unpriced = ctx.db.query("products").withIndex("by_price", (q) => q.eq("price", undefined));
    let scanned = 0;
    for await (const p of unpriced) {
      if (++scanned > 2000 || out.length >= args.limit) break;
      if (p.priceCheckedAt && p.priceCheckedAt > retryBefore) continue;
      const url = [p.storeUrl, p.supplierUrl].find(isFetchableUrl);
      if (url) out.push({ id: p._id, url });
    }
    return out;
  },
});

export const savePrice = internalMutation({
  args: { id: v.id("products"), price: v.optional(v.number()), originalPrice: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get("products", args.id);
    if (!p || p.price !== undefined) return;
    await ctx.db.patch("products", args.id, {
      priceCheckedAt: new Date().toISOString(),
      ...(args.price !== undefined ? { price: args.price, priceSource: "landing_page" } : {}),
      ...(args.originalPrice ? { originalPrice: args.originalPrice } : {}),
    });
  },
});

async function readPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AdSpyProBot/1.0; +price check)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c.subarray(0, Math.max(0, size - at)), at);
      at += c.length;
    }
    return new TextDecoder().decode(all);
  } catch {
    return null;
  }
}

export const run = internalAction({
  // pipelineDay: started by the daily pipeline, which continues when this reports back.
  args: { round: v.number(), pipelineDay: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let scheduledNext = false;
    let note: string | undefined;
    try {
      const todo = await ctx.runQuery(internal.priceFetch.candidates, { limit: BATCH });
      for (let i = 0; i < todo.length; i += 5) {
        await Promise.all(
          todo.slice(i, i + 5).map(async ({ id, url }) => {
            const html = await readPage(url);
            const found = html ? priceFromHtml(html) : undefined;
            const usd = found ? toUsd(found) : undefined;
            await ctx.runMutation(internal.priceFetch.savePrice, {
              id,
              ...(found ? { originalPrice: priceLabel(found) } : {}),
              ...(usd !== undefined ? { price: usd } : {}),
            });
          }),
        );
      }
      if (todo.length === BATCH && args.round + 1 < MAX_ROUNDS) {
        await ctx.scheduler.runAfter(0, internal.priceFetch.run, { round: args.round + 1, pipelineDay: args.pipelineDay });
        scheduledNext = true;
      }
    } catch (e) {
      note = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      throw e;
    } finally {
      if (!scheduledNext && args.pipelineDay) {
        await ctx.runMutation(internal.productPipeline.actionDone, { day: args.pipelineDay, stage: "landingPages", note });
      }
    }
  },
});
