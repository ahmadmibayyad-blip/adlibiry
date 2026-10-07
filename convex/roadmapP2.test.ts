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
