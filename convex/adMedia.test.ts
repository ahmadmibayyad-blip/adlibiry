/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (headline: string, over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "DK",
  niche: "Pet Supplies",
  headline,
  bodyText: "No water, no power.",
  creativeUrl: "",
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

afterEach(() => vi.unstubAllGlobals());

describe("adMediaAction.daily", () => {
  it("copies images, saved ads' videos, and marks what couldn't be copied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("expired")) return new Response("gone", { status: 403 });
        if (url.endsWith(".mp4")) return new Response(new Uint8Array([0, 0, 0, 24]), { status: 200, headers: { "content-type": "video/mp4" } });
        return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1" });
      const saved = await ctx.db.insert("ads", ad("saved", { creativeUrl: "https://cdn.example/s.jpg", videoUrl: "https://cdn.example/s.mp4" }));
      await ctx.db.insert("savedAds", { userId, adId: saved, savedAt: "2026-10-17T00:00:00.000Z" });
      return {
        saved,
        fresh: await ctx.db.insert("ads", ad("fresh", { creativeUrl: "https://cdn.example/f.jpg", videoUrl: "https://cdn.example/f.mp4" })),
        expired: await ctx.db.insert("ads", ad("expired", { creativeUrl: "https://cdn.example/expired.jpg" })),
        bare: await ctx.db.insert("ads", ad("bare", {})),
      };
    });

    const r = await t.action(internal.adMediaAction.daily, {});
    expect(r.updated).toBe(2);
    expect(r.errors).toHaveLength(1);

    const get = (id: typeof ids.saved) => t.run((ctx) => ctx.db.get("ads", id));
    const saved = (await get(ids.saved))!;
    expect([saved.mediaStatus, saved.videoStatus]).toEqual(["done", "done"]);
    expect(saved.hostedImageUrl).toBeTruthy();
    expect(saved.hostedVideoUrl).toBeTruthy();
    const fresh = (await get(ids.fresh))!;
    expect([fresh.mediaStatus, fresh.hostedVideoId]).toEqual(["done", undefined]);
    expect((await get(ids.expired))!.mediaStatus).toBe("failed");
    expect((await get(ids.bare))!.mediaStatus).toBe("none");

    // Nothing left: a second run copies nothing.
    expect((await t.action(internal.adMediaAction.daily, {})).fetched).toBe(0);
  });
});
