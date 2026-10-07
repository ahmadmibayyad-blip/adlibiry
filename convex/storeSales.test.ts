/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const baseStore = {
  logoUrl: "", niche: "Pet Supplies", country: "US", platform: "Shopify", estimatedRevenueRange: "Unknown",
  trafficRange: "Unknown", activeAdsCount: 0, bestSellers: [], isHighTraffic: false, spottedAt: "2026-10-01T00:00:00.000Z",
};

function stubCatalog(products: object[] | "fail") {
  vi.stubGlobal("fetch", async () => {
    if (products === "fail") return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ products }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("store sales tracking", () => {
  it("saves a daily snapshot and, after 3 days, the store's revenue range", async () => {
    const t = convexTest(schema, modules);
    const storeId = await t.run((ctx) => ctx.db.insert("stores", { ...baseStore, name: "Paw Shop", url: "pawshop.com" }));
    vi.useFakeTimers({ toFake: ["Date"] });

    for (const [i, day] of ["2026-10-01", "2026-10-02", "2026-10-03"].entries()) {
      vi.setSystemTime(new Date(`${day}T10:00:00Z`));
      stubCatalog([
        { title: "Cat Toy", handle: "cat-toy", created_at: "2026-01-01T00:00:00Z", updated_at: `${day}T09:00:00Z`, variants: [{ price: "20" }] },
        { title: "Lamp", handle: "lamp", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", variants: [{ price: "10" }] },
      ]);
      const r = await t.action(internal.storeSales.checkOne, { storeId });
      expect(r).toEqual({ status: "ok", updatedCount: 1 });
      const h = await t.withIdentity({ subject: "test|s" }).query(api.storeSales.history, { storeId });
      expect(h?.days).toHaveLength(i + 1);
    }
    const h = await t.withIdentity({ subject: "test|s" }).query(api.storeSales.history, { storeId });
    expect(h?.days[2]).toMatchObject({ day: "2026-10-03", windowHours: 24, updatedCount: 1, estRevenueLow: 20, estRevenueHigh: 60 });
    expect(h?.days[2].topProducts[0].url).toBe("https://pawshop.com/products/cat-toy");
    expect(h?.check).toMatchObject({ ok: true, failures: 0 });
    const store = await t.run((ctx) => ctx.db.get("stores", storeId));
    // One figure (middle of 1–3 orders per changed product), not a 3× range.
    expect(store?.estimatedRevenueRange).toBe("~$1K/mo");
    expect(store?.revenueConfidence).toBe("Medium");
  });

  it("respects robots.txt, converts prices from the store's currency and records catalog changes", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("siteStats", { key: "fxRates", data: { rates: { USD: 1, EUR: 0.8, GBP: 0.75, DKK: 6.5 }, all: { USD: 1, EUR: 0.8 }, date: "2026-10-01" }, updatedAt: "2026-10-01" });
      return {
        blocked: await ctx.db.insert("stores", { ...baseStore, name: "Private", url: "private.com" }),
        euro: await ctx.db.insert("stores", { ...baseStore, name: "Euro Shop", url: "euro.shop" }),
      };
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    let catalog = [{ title: "Mug", handle: "mug", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-01T09:00:00Z", variants: [{ price: "8" }] }];
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(url.includes("private.com") ? "User-agent: *\nDisallow: /products.json" : "User-agent: *\nDisallow: /checkout", { status: 200 });
      }
      if (url.endsWith("/cart.js")) return new Response(JSON.stringify({ currency: "EUR" }), { status: 200 });
      return new Response(JSON.stringify({ products: catalog }), { status: 200 });
    });

    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    expect(await t.action(internal.storeSales.checkOne, { storeId: ids.blocked })).toEqual({
      status: "error",
      error: "The store's robots.txt asks crawlers not to read its catalog",
    });
    expect(seen.some((u) => u.includes("private.com/products.json"))).toBe(false);

    await t.action(internal.storeSales.checkOne, { storeId: ids.euro });
    let h = await t.withIdentity({ subject: "test|s" }).query(api.storeSales.history, { storeId: ids.euro });
    expect(h?.days[0]).toMatchObject({ currency: "EUR", avgPrice: 10 }); // €8 at 0.8 €/$ = $10

    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));
    catalog = [
      { title: "Mug", handle: "mug", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-02T09:00:00Z", variants: [{ price: "12" }] },
      { title: "Plate", handle: "plate", created_at: "2026-10-02T08:00:00Z", updated_at: "2026-10-02T08:00:00Z", variants: [{ price: "4" }] },
    ];
    await t.action(internal.storeSales.checkOne, { storeId: ids.euro });
    h = await t.withIdentity({ subject: "test|s" }).query(api.storeSales.history, { storeId: ids.euro });
    expect(h?.days[1].diff).toMatchObject({ added: 1, removed: 0, priceChanges: 1 });
  });

  it("records failures and stops picking a store after 3", async () => {
    const t = convexTest(schema, modules);
    const storeId = await t.run((ctx) => ctx.db.insert("stores", { ...baseStore, name: "Fake", url: "https://fake.example" }));
    stubCatalog("fail");
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let d = 1; d <= 3; d++) {
      vi.setSystemTime(new Date(`2026-10-0${d}T10:00:00Z`));
      expect(await t.query(internal.storeSales.candidates, {})).toHaveLength(1);
      expect(await t.action(internal.storeSales.checkOne, { storeId })).toEqual({ status: "error", error: "No public Shopify catalog" });
    }
    vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
    expect(await t.query(internal.storeSales.candidates, {})).toHaveLength(0);
    expect((await t.withIdentity({ subject: "test|s" }).query(api.storeSales.history, { storeId }))?.check).toMatchObject({ ok: false, failures: 3 });
  });

  it("checkNow needs sign-in and is limited to once an hour", async () => {
    const t = convexTest(schema, modules);
    const storeId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("stores", { ...baseStore, name: "Paw Shop", url: "pawshop.com" });
    });
    stubCatalog([]);
    await expect(t.action(api.storeSales.checkNow, { storeId })).rejects.toThrow(/sign in/);
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.action(api.storeSales.checkNow, { storeId })).toEqual({ status: "ok", updatedCount: 0 });
    expect(await me.action(api.storeSales.checkNow, { storeId })).toEqual({ status: "recent" });
  });
});

describe("store alerts", () => {
  it("tells trackers about new products on the first check of the day", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));
    const storeId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const id = await ctx.db.insert("stores", { ...baseStore, name: "Paw Shop", url: "pawshop.com" });
      await ctx.db.insert("trackedStores", { userId, storeId: id, trackedAt: "2026-10-01T00:00:00Z" });
      return id;
    });
    stubCatalog([{ title: "New Mat", handle: "mat", created_at: "2026-10-02T07:00:00Z", updated_at: "2026-10-02T07:00:00Z", variants: [{ price: "15" }] }]);
    await t.action(internal.storeSales.checkOne, { storeId });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    await t.action(internal.storeSales.checkOne, { storeId }); // same day: no second alert
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const alerts = jobs.filter((j) => j.name.includes("notifyTrackersOfStoreUpdate"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].args[0]).toMatchObject({ title: "Paw Shop added 1 new product", link: `/dashboard/stores?store=${storeId}` });
  });
});
