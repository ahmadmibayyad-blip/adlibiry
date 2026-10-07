/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { isDemoAd, isDemoStore, productFacts } from "./lib/aiFacts";

const modules = import.meta.glob("./**/*.ts");

describe("AI second opinion facts", () => {
  it("says unknown instead of sending $0", () => {
    const base = { title: "Dog mat", category: "Pet Supplies", description: "Cooling mat" };
    expect(productFacts({ ...base, price: 40, cost: 10 })).toContain("Margin: 75%");
    const noCost = productFacts({ ...base, price: 40 });
    expect(noCost).toContain("Supplier cost: unknown");
    expect(noCost).toContain("Margin: unknown");
    expect(noCost).not.toContain("$0");
    expect(productFacts({ ...base, price: 0, cost: 0 })).toContain("Sell price: unknown");
  });
});

describe("demo data never shows as real competitors", () => {
  it("recognises every seeded store and ad, and nothing real", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }));
    const admin = t.withIdentity({ subject: "a1|s" });
    await admin.mutation(api.stores.seedStores, {});
    await admin.mutation(api.ads.seedAds, {});
    const { stores, ads } = await t.run(async (ctx) => ({
      stores: await ctx.db.query("stores").collect(),
      ads: await ctx.db.query("ads").collect(),
    }));
    expect(stores.length).toBeGreaterThan(0);
    expect(ads.length).toBeGreaterThan(0);
    expect(stores.every(isDemoStore)).toBe(true);
    expect(ads.every(isDemoAd)).toBe(true);
    expect(isDemoStore({ url: "https://pawshop.com" })).toBe(false);
    expect(isDemoAd({ landingPageUrl: "https://paws.example.org/products/mat" })).toBe(false);
  });
});
