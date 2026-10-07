/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const baseStore = {
  logoUrl: "", niche: "Pet Supplies", country: "US", platform: "Shopify", estimatedRevenueRange: "Unknown",
  trafficRange: "Unknown", activeAdsCount: 0, bestSellers: [], isHighTraffic: false, spottedAt: "2026-10-01T00:00:00.000Z",
};
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 }))));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("store watchlist 2.0", () => {
  it("Free accounts watch up to 5 stores, Pro up to 50", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "free", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      const out = [];
      for (let i = 0; i < 6; i++) out.push(await ctx.db.insert("stores", { ...baseStore, name: `S${i}`, url: `https://s${i}.example` }));
      return out;
    });
    const free = t.withIdentity({ subject: "free|s" });
    for (const id of ids.slice(0, 5)) await free.mutation(api.stores.toggleTrackStore, { storeId: id });
    await expect(free.mutation(api.stores.toggleTrackStore, { storeId: ids[5] })).rejects.toThrow(/Free accounts can watch 5 stores/);
    const pro = t.withIdentity({ subject: "pro|s" });
    for (const id of ids) await pro.mutation(api.stores.toggleTrackStore, { storeId: id });
    expect(await pro.query(api.stores.getTrackedStores, {})).toHaveLength(6);
  });

  it("records when products first appear and alerts watchers to price changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      const storeId = await ctx.db.insert("stores", { ...baseStore, name: "Paw Shop", url: "https://pawshop.com" });
      await ctx.db.insert("trackedStores", { userId, storeId, trackedAt: "2026-10-01T00:00:00Z" });
      return { storeId };
    });
    let products = [{ title: "Mat", handle: "mat", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", variants: [{ price: "20" }] }];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("/products.json") ? new Response(JSON.stringify({ products }), { status: 200 }) : new Response("", { status: 404 }))));
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    await t.action(internal.storeSales.checkOne, { storeId });
    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));
    products = [
      { ...products[0], variants: [{ price: "25" }] },
      { title: "Bowl", handle: "bowl", created_at: "2026-10-02T08:00:00Z", updated_at: "2026-10-02T08:00:00Z", variants: [{ price: "9" }] },
    ];
    await t.action(internal.storeSales.checkOne, { storeId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const cat = await t.withIdentity({ subject: "pro|s" }).query(api.storeSales.catalog, { storeId });
    expect(cat?.entries.find((e) => e.handle === "bowl")?.firstSeen).toBe("2026-10-02");
    expect(cat?.entries.find((e) => e.handle === "mat")?.firstSeen).toBeUndefined(); // there before tracking
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.title)).toContain("Paw Shop changed 1 price");
  });

  it("alerts watchers when the store launches new ads (ads tied back by its domain)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T08:05:00Z"));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      const storeId = await ctx.db.insert("stores", { ...baseStore, name: "Paw Shop", url: "https://pawshop.com", host: "pawshop.com" });
      await ctx.db.insert("trackedStores", { userId, storeId, trackedAt: "2026-10-01T00:00:00Z" });
      await ctx.db.insert("ads", {
        advertiserName: "Paw Shop", platform: "Facebook", country: "US", niche: "Pet Supplies", headline: "Cool mats are back",
        bodyText: "Shop now", creativeUrl: "", landingPageUrl: "https://www.pawshop.com/products/cool-mat", spendEstimate: "Unknown",
        likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "18-65", gender: "All", interests: [] },
        firstSeenAt: "2026-10-02T07:00:00.000Z", source: "apify",
      });
    });
    await t.mutation(internal.productPipeline.start, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.title)).toContain("Paw Shop launched 1 new ad");
  });
});

describe("TikTok Shop tab", () => {
  it("ranks TikTok Shop products by monthly sales and can keep to the user's niches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "pro", role: "user", plan: "pro", subscriptionStatus: "active" });
      const p = { description: "", imageUrl: "", tags: [], aiScore: 60, saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z" };
      await ctx.db.insert("products", { ...p, title: "Lip oil", category: "Beauty", source: "tiktok_shop", unitsPerMonth: 9000 });
      await ctx.db.insert("products", { ...p, title: "Dog brush", category: "Pet Supplies", source: "tiktok_shop", unitsPerMonth: 3000 });
      await ctx.db.insert("products", { ...p, title: "Cat toy", category: "Pet Supplies", source: "tiktok_shop", unitsPerMonth: 12000 });
      await ctx.db.insert("products", { ...p, title: "Amazon mat", category: "Pet Supplies", source: "nexscope_api", unitsPerMonth: 99999 });
    });
    const pro = t.withIdentity({ subject: "pro|s" });
    const all = await pro.query(api.products.tiktokShop, { paginationOpts: { numItems: 10, cursor: null } });
    expect(all.page.map((p) => p.title)).toEqual(["Cat toy", "Lip oil", "Dog brush"]);
    const pets = await pro.query(api.products.tiktokShop, { paginationOpts: { numItems: 10, cursor: null }, niches: ["Pet Supplies"] });
    expect(pets.page.map((p) => p.title)).toEqual(["Cat toy", "Dog brush"]);
  });
});

describe("video transcripts", () => {
  it("is off without a key, then saves the spoken hook and doesn't retry dead links", async () => {
    const t = convexTest(schema, modules);
    const { ok, dead } = await t.run(async (ctx) => {
      const base = {
        advertiserName: "Paw Shop", platform: "TikTok", country: "US", niche: "Pet Supplies", headline: "Mat", bodyText: "", creativeUrl: "",
        landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 20, targeting: { ageRange: "18-65", gender: "All", interests: [] },
        firstSeenAt: "2026-10-01T00:00:00.000Z", source: "pipispy",
      };
      return {
        ok: await ctx.db.insert("ads", { ...base, aiScore: 90, videoUrl: "https://cdn.example.com/ok.mp4" }),
        dead: await ctx.db.insert("ads", { ...base, aiScore: 80, videoUrl: "https://cdn.example.com/dead.mp4" }),
      };
    });
    expect(await t.action(internal.transcripts.dailyTranscripts, {})).toEqual({ notConfigured: "DEEPGRAM_API_KEY isn't set (video transcripts)" });
    vi.stubEnv("DEEPGRAM_API_KEY", "dg_test");
    const w = (word: string, start: number) => ({ word, punctuated_word: word, start, end: start + 0.3 });
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      if (JSON.parse(init.body).url.includes("dead")) return new Response(JSON.stringify({ err_msg: "Failed to fetch media" }), { status: 400 });
      const words = [w("Your", 0.1), w("dog", 0.5), w("will", 0.9), w("thank", 1.2), w("you", 1.5), w("for", 1.8), w("this.", 2.2), w("Look", 4)];
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "Your dog will thank you for this. Look", words }] }] } }), { status: 200 });
    }));
    const r = await t.action(internal.transcripts.dailyTranscripts, {});
    expect(r).toMatchObject({ fetched: 1, updated: 1 });
    const [a, b] = await t.run(async (ctx) => [await ctx.db.get("ads", ok), await ctx.db.get("ads", dead)]);
    expect(a?.spokenHook).toBe("Your dog will thank you for this.");
    expect(b?.transcriptCheckedAt).toBeDefined(); // not retried every day
    expect(await t.action(internal.transcripts.dailyTranscripts, {})).toMatchObject({ fetched: 0 });
    vi.unstubAllEnvs();
  });
});

