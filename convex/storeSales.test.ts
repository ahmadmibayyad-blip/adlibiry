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
      const h = await t.query(api.storeSales.history, { storeId });
      expect(h?.days).toHaveLength(i + 1);
    }
    const h = await t.query(api.storeSales.history, { storeId });
    expect(h?.days[2]).toMatchObject({ day: "2026-10-03", windowHours: 24, updatedCount: 1, estRevenueLow: 20, estRevenueHigh: 60 });
    expect(h?.days[2].topProducts[0].url).toBe("https://pawshop.com/products/cat-toy");
    expect(h?.check).toMatchObject({ ok: true, failures: 0 });
    const store = await t.run((ctx) => ctx.db.get("stores", storeId));
    expect(store?.estimatedRevenueRange).toBe("$600–$1.8K/mo");
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
    expect((await t.query(api.storeSales.history, { storeId }))?.check).toMatchObject({ ok: false, failures: 3 });
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
