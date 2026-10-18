/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { hashBandFields, sameImageMatches } from "./lib/imageHash";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "DK",
  niche: "Pet Supplies",
  headline: "Keep your dog cool",
  bodyText: "No water, no power.",
  creativeUrl: "https://cdn.example.com/a.jpg",
  landingPageUrl: "https://paws.example.com/",
  spendEstimate: "Unknown",
  likes: 0,
  views: "0",
  daysRunning: 10,
  aiScore: 50,
  targeting: { ageRange: "Unknown", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  source: "apify",
  ...over,
});

const HASH = "0f0f0f0f0f0f0f0f";
// Flip `bits` low bits of the last hex digits: that many bits apart.
const near = (bits: number) => HASH.slice(0, 15) + (0xf ^ ((1 << bits) - 1)).toString(16);

describe("sameImageMatches", () => {
  it("keeps hashes 4 bits apart or closer, closest first then most views", () => {
    const cands = [
      { _id: "self", imageHash: HASH },
      { _id: "far", imageHash: "f0f0f0f0f0f0f0f0" },
      { _id: "two", imageHash: near(2), v: 50 },
      { _id: "same", imageHash: HASH, v: 1 },
      { _id: "same2", imageHash: HASH, v: 9 },
      { _id: "two", imageHash: near(2), v: 50 },
      { _id: "bad", imageHash: "" },
    ];
    const m = sameImageMatches(HASH, cands, "self", (c) => c.v ?? 0);
    expect(m.map((x) => [x.item._id, x.distance])).toEqual([["same2", 0], ["same", 0], ["two", 2]]);
  });

  it("gives no parts for an unusable hash", () => {
    expect(hashBandFields("")).toEqual({ hashBand0: undefined, hashBand1: undefined, hashBand2: undefined, hashBand3: undefined });
    expect(hashBandFields(HASH).hashBand0).toBe("0f0f");
  });
});

describe("ads.sameCreative", () => {
  it("finds other ads with the same creative, and says when the image isn't read yet", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" }));
    const user = t.withIdentity({ subject: "u1|s" });
    const ids = await t.run(async (ctx) => ({
      mine: await ctx.db.insert("ads", ad({})),
      copy: await ctx.db.insert("ads", ad({ advertiserName: "Copycat Shop", impressions: 5000 })),
      resized: await ctx.db.insert("ads", ad({ advertiserName: "Other Store", impressions: 100 })),
      unrelated: await ctx.db.insert("ads", ad({ advertiserName: "Someone" })),
      unhashed: await ctx.db.insert("ads", ad({ advertiserName: "New" })),
    }));
    // Hashes saved the way the image-hash job saves them.
    await t.mutation(internal.imageHash.saveHashes, {
      products: [],
      ads: [
        { id: ids.mine, hash: HASH },
        { id: ids.copy, hash: HASH },
        { id: ids.resized, hash: near(3) },
        { id: ids.unrelated, hash: "f0f0f0f0f0f0f0f0" },
      ],
    });
    const r = await user.query(api.ads.sameCreative, { adId: ids.mine });
    expect(r?.status).toBe("ok");
    expect(r?.ads.map((a) => [a.advertiserName, a.distance])).toEqual([["Copycat Shop", 0], ["Other Store", 3]]);
    expect(r).toMatchObject({ total: 2, advertisers: 2 });
    expect((await user.query(api.ads.sameCreative, { adId: ids.unhashed }))?.status).toBe("pending");
  });
});
