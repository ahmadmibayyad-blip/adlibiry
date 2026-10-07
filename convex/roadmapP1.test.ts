/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const product = {
  title: "Dog cooling mat", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Low",
  trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z", price: 40,
};

describe("supplier sourcing", () => {
  it("saves the top suppliers and fills a missing cost from the best one, without overwriting a set cost", async () => {
    const t = convexTest(schema, modules);
    const { open, curated } = await t.run(async (ctx) => ({
      open: await ctx.db.insert("products", product),
      curated: await ctx.db.insert("products", { ...product, title: "Curated mat", cost: 9 }),
    }));
    const matches = [
      { title: "Pet cooling mat", price: 12, url: "https://s.click.aliexpress.com/a", rating: 96, orders: 1200, similarity: 0.8 },
      { title: "Dog cool pad", price: 10, url: "https://s.click.aliexpress.com/b", similarity: 0.5 },
    ];
    await t.mutation(internal.aliexpress.saveSuppliers, { id: open, matches, shipping: 3 });
    await t.mutation(internal.aliexpress.saveSuppliers, { id: curated, matches, shipping: 3 });
    const [a, b] = await t.run(async (ctx) => [await ctx.db.get("products", open), await ctx.db.get("products", curated)]);
    expect(a).toMatchObject({ cost: 15, costSource: "aliexpress", costUrl: "https://s.click.aliexpress.com/a" });
    expect(a?.supplierMatches).toHaveLength(2);
    expect(b).toMatchObject({ cost: 9 }); // set by an admin/import: kept
    expect(b?.supplierMatches).toHaveLength(2);
  });
});

describe("north-star events", () => {
  it("records each event once per day and counts verdict + save as a validated test", async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
      return await ctx.db.insert("products", product);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    await me.mutation(api.events.track, { type: "product_open", productId });
    await me.mutation(api.events.track, { type: "product_open", productId }); // same day: once
    await me.mutation(api.events.track, { type: "verdict_view", productId });
    await me.mutation(api.products.toggleSave, { productId });
    const weekly = await t.withIdentity({ subject: "a1|s" }).query(api.events.weekly, {});
    expect(weekly).toMatchObject({ activeUsers: 1, validatedTests: 1, perActiveUser: 1 });
    expect(weekly.funnel).toEqual({ product_open: 1, verdict_view: 1, product_save: 1, supplier_click: 0 });
    // Signed-out visitors aren't tracked; only admins see the numbers.
    await t.mutation(api.events.track, { type: "product_open", productId });
    await expect(me.query(api.events.weekly, {})).rejects.toThrow();
  });
});

describe("target country", () => {
  it("is saved at onboarding and changeable in Settings", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const me = t.withIdentity({ subject: "u1|s" });
    await me.mutation(api.onboarding.complete, { niches: ["Pet Supplies"], digest: false, targetCountry: "DE" });
    expect(await me.query(api.onboarding.mine, {})).toMatchObject({ targetCountry: "DE" });
    await me.mutation(api.onboarding.setTargetCountry, { country: "DK" });
    expect(await me.query(api.onboarding.mine, {})).toMatchObject({ targetCountry: "DK" });
    await expect(me.mutation(api.onboarding.setTargetCountry, { country: "Denmark" })).rejects.toThrow(/Pick a country/);
  });
});
