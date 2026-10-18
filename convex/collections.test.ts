/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAX_COLLECTIONS } from "./collections";

const modules = import.meta.glob("./**/*.ts");

const adBase = {
  advertiserName: "PawCo", platform: "Facebook", country: "US", niche: "Pet Supplies", headline: "Cooling mat", bodyText: "",
  creativeUrl: "https://img.example/ad.jpg", landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
  targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};
const storeBase = {
  name: "Paw Store", url: "https://paw.example", logoUrl: "https://paw.example/logo.png", niche: "Pet Supplies", country: "US",
  platform: "Shopify", estimatedRevenueRange: "", trafficRange: "", activeAdsCount: 0, bestSellers: [], isHighTraffic: false,
  spottedAt: "2026-10-01T00:00:00.000Z",
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
    const adId = await ctx.db.insert("ads", adBase);
    const storeId = await ctx.db.insert("stores", storeBase);
    return { adId, storeId };
  });
  return { t, ...ids, me: t.withIdentity({ subject: "u1|s" }), other: t.withIdentity({ subject: "u2|s" }) };
}

describe("collections", () => {
  it("needs a signed-in user", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.collections.create, { name: "Pets" })).rejects.toThrow(/sign in/);
    expect(await t.query(api.collections.mine, {})).toEqual([]);
  });

  it("creates a collection, adds an ad and a store, and lists them", async () => {
    const { me, adId, storeId } = await setup();
    const id = await me.mutation(api.collections.create, { name: "  Pet   winners ", item: { kind: "ad", refId: adId } });
    expect(await me.mutation(api.collections.toggleItem, { id, kind: "store", refId: storeId })).toEqual({ added: true });

    const [c] = await me.query(api.collections.mine, { kind: "ad", refId: adId });
    expect(c).toMatchObject({ name: "Pet winners", itemCount: 2, has: true });
    expect(c.covers).toEqual(["https://paw.example/logo.png", "https://img.example/ad.jpg"]);

    const full = await me.query(api.collections.get, { id });
    expect(full?.ads.map((a) => a._id)).toEqual([adId]);
    expect(full?.stores.map((s) => s._id)).toEqual([storeId]);
    expect(full).toMatchObject({ gone: 0, more: false });
  });

  it("toggling an item that's already in it takes it out", async () => {
    const { me, adId } = await setup();
    const id = await me.mutation(api.collections.create, { name: "Pets", item: { kind: "ad", refId: adId } });
    expect(await me.mutation(api.collections.toggleItem, { id, kind: "ad", refId: adId })).toEqual({ added: false });
    const [c] = await me.query(api.collections.mine, { kind: "ad", refId: adId });
    expect(c).toMatchObject({ itemCount: 0, has: false, covers: [] });
  });

  it("refuses duplicate names, empty names and items that don't exist", async () => {
    const { me, adId } = await setup();
    await me.mutation(api.collections.create, { name: "Pets" });
    await expect(me.mutation(api.collections.create, { name: "pets" })).rejects.toThrow(/already have/);
    await expect(me.mutation(api.collections.create, { name: "   " })).rejects.toThrow(/name/);
    await expect(me.mutation(api.collections.create, { name: "X", item: { kind: "store", refId: adId } })).rejects.toThrow(/no longer exists/);
  });

  it("keeps other users out", async () => {
    const { me, other, adId } = await setup();
    const id = await me.mutation(api.collections.create, { name: "Pets" });
    expect(await other.query(api.collections.get, { id })).toBeNull();
    expect(await other.query(api.collections.mine, {})).toEqual([]);
    await expect(other.mutation(api.collections.toggleItem, { id, kind: "ad", refId: adId })).rejects.toThrow(/not found/);
    await expect(other.mutation(api.collections.remove, { id })).rejects.toThrow(/not found/);
    await expect(other.mutation(api.collections.rename, { id, name: "Mine now" })).rejects.toThrow(/not found/);
  });

  it("renames, and deletes with its items", async () => {
    const { t, me, adId } = await setup();
    const id = await me.mutation(api.collections.create, { name: "Pets", item: { kind: "ad", refId: adId } });
    await me.mutation(api.collections.rename, { id, name: "Dogs" });
    expect((await me.query(api.collections.mine, {}))[0].name).toBe("Dogs");
    await me.mutation(api.collections.remove, { id });
    expect(await me.query(api.collections.mine, {})).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("collectionItems").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("ads", adId))).not.toBeNull();
  });

  it("counts removed items as gone", async () => {
    const { t, me, adId } = await setup();
    const id = await me.mutation(api.collections.create, { name: "Pets", item: { kind: "ad", refId: adId } });
    await t.run((ctx) => ctx.db.delete("ads", adId));
    expect(await me.query(api.collections.get, { id })).toMatchObject({ ads: [], gone: 1 });
  });

  it("stops at the collection limit", async () => {
    const { t, me } = await setup();
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      for (let i = 0; i < MAX_COLLECTIONS; i++) {
        await ctx.db.insert("collections", { userId: user!._id, name: `C${i}`, itemCount: 0, createdAt: "", updatedAt: "" });
      }
    });
    await expect(me.mutation(api.collections.create, { name: "One more" })).rejects.toThrow(/up to/);
  });
});
