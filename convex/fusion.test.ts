/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { rebuildWinners } from "./productPipeline";

const modules = import.meta.glob("./**/*.ts");
const DAY = "2026-10-07";
const product = {
  description: "", imageUrl: "https://cdn.example.com/p.jpg", tags: [], saturation: "Low", trend: "Rising", supplierUrl: "",
  adExamples: [], isWinnerOfDay: false, publishedAt: "2026-09-01T00:00:00.000Z",
};
const ad = {
  platform: "Facebook", country: "DE", niche: "Pet Supplies", headline: "Cool mat", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 20, aiScore: 80, firstSeenAt: "2026-09-10T00:00:00.000Z",
  targeting: { ageRange: "18-65", gender: "All", interests: [] as string[] },
};
const external = (source: string, extra: Record<string, unknown>) => ({
  externalId: "meta_42", source, advertiserName: "Corecare", platform: "Facebook", country: "DE", niche: "Health & Wellness",
  headline: "Instant Posture Corrector", bodyText: "Sit straight", creativeUrl: "", landingPageUrl: "https://corecareshop.com/products/x",
  spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 40, aiScore: 70, firstSeenAt: "2026-08-28T00:00:00.000Z", ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("one ad, several sources", () => {
  it("merges Apify and Meta's API on one row by field priority and logs where they disagree", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sources.links.upsertExternalAds, { ads: [external("apify", { advertiserName: "Corecareshop", views: "48.0K", isActive: true })] });
    await t.mutation(internal.sources.links.upsertExternalAds, { ads: [external("meta_ad_library", { isActive: false })] });
    const [row] = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(row).toMatchObject({ source: "meta_ad_library", sources: ["apify", "meta_ad_library"], isActive: false, advertiserName: "Corecare", views: "48.0K" });
    expect(row.sourceFields).toMatchObject({ live: { source: "meta_ad_library" }, advertiser: { source: "meta_ad_library" }, engagement: { source: "apify" } });
    const conflicts = await t.run((ctx) => ctx.db.query("sourceConflicts").collect());
    expect(conflicts.map((c) => c.field).sort()).toEqual(["advertiser", "live"]);
  });

  it("doesn't let marketplace data overwrite the store's own price", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("products", { ...product, title: "Mat", category: "Pet Supplies", aiScore: 50, price: 29, priceSource: "landing_page", source: "tiktok_shop" }));
    await t.run((ctx) => ctx.db.insert("nexscopeSyncedProducts", { externalId: "tts_1", productId: id, lastSyncedAt: "2026-10-01T00:00:00Z" }));
    await t.mutation(internal.nexscope.productDiscovery.upsertDiscovered, {
      externalId: "tts_1", title: "Mat", description: "", imageUrl: "", price: 19, category: "Pet Supplies", tags: [], aiScore: 55,
      trend: "Rising", supplierUrl: "https://shop.tiktok.com/x", source: "tiktok_shop",
    } as never);
    const p = await t.run((ctx) => ctx.db.get("products", id));
    expect(p).toMatchObject({ price: 29, priceSource: "landing_page", aiScore: 55 });
  });
});

describe("verified winners", () => {
  it("marks a winner verified only when its sources agree, and remembers when it first won", async () => {
    const t = convexTest(schema, modules);
    const crossValidated = { families: ["engagement", "marketplace", "registry"], adLevel: true, productLevel: true, confidence: 100, crossValidated: true };
    const winner = {
      ...product, category: "Pet Supplies", aiScore: 90, estRevenue: { low: 20000, high: 40000 }, activeAds: 5, momentum14: 12, source: "tiktok_shop",
    };
    const [a, b] = await t.run(async (ctx) => [
      await ctx.db.insert("products", { ...winner, title: "Verified mat", fusion: crossValidated }),
      await ctx.db.insert("products", { ...winner, title: "One-source mat", aiScore: 89, fusion: { ...crossValidated, families: ["engagement"], crossValidated: false } }),
    ]);
    await t.run((ctx) => rebuildWinners(ctx, DAY));
    const [pa, pb] = await t.run(async (ctx) => [await ctx.db.get("products", a), await ctx.db.get("products", b)]);
    expect(pa).toMatchObject({ verifiedWinner: true, winnerSince: DAY });
    expect(pb?.verifiedWinner).toBeUndefined();
    expect(pb?.winnerSince).toBe(DAY);
  });
});

describe("event-driven enrichment", () => {
  async function winnerWithAdvertiser(t: ReturnType<typeof convexTest>, title: string, score: number) {
    return await t.run(async (ctx) => {
      const p = await ctx.db.insert("products", { ...product, title, category: "Pet Supplies", aiScore: score, source: "ads" });
      const adId = await ctx.db.insert("ads", { ...ad, advertiserName: `${title} Shop`, source: "meta_ad_library", productId: p });
      await ctx.db.patch("products", p, { adIds: [adId], saturationByCountry: [{ country: "DE", advertisers: 2, level: "Low" }] });
      await ctx.db.insert("winningProducts", { productId: p, niche: "Pet Supplies", nicheRank: 1, position: score, score, enteredDay: DAY });
      return p;
    });
  }

  it("A: sends new winners' advertisers to Apify within the daily budget, once each", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    vi.stubEnv("APIFY_DAILY_BUDGET_USD", "0.1"); // room for one $0.07 run
    const started: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: { body?: string }) => {
      if (String(u).includes("/runs?")) {
        started.push(JSON.parse(init?.body ?? "{}").urls[0].url);
        return new Response(JSON.stringify({ data: { id: `run${started.length}`, status: "RUNNING" } }), { status: 201 });
      }
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    const top = await winnerWithAdvertiser(t, "Paw", 95);
    await winnerWithAdvertiser(t, "Bowl", 80);
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.winner).toMatchObject({ done: 1, skipped: "daily Apify budget reached" });
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("q=Paw+Shop");
    expect(started[0]).toContain("keyword_exact_phrase");
    const runs = await t.run((ctx) => ctx.db.query("apifyRuns").collect());
    expect(runs[0]).toMatchObject({ trigger: "winner", productId: top, day: DAY, capUsd: 0.07 });
    expect((await t.run((ctx) => ctx.db.get("products", top)))?.enrichedAt).toBe(DAY);
    // Tomorrow: the budget is fresh, Paw isn't sent again, Bowl is.
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    await t.action(internal.fusion.runTriggers, { day: "2026-10-08" });
    expect(started).toHaveLength(2);
    expect(started[1]).toContain("q=Bowl+Shop");
  });

  it("B: alerts a niche's watchers when new sellers flood it, once a week", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("alertPreferences", {
        userId, watchedNiches: ["Pet Supplies"], notifyNewWinners: true, notifyNewAdsInNiches: true, notifyTrackedStoreUpdates: true,
        emailDigestEnabled: false, updatedAt: DAY,
      });
      await ctx.db.insert("siteStats", { key: "nicheAdvertisers", data: { days: { "2026-09-30": { "Pet Supplies|DE": 2 } }, alerted: {} }, updatedAt: DAY });
      for (let i = 0; i < 8; i++) {
        await ctx.db.insert("ads", { ...ad, advertiserName: `Seller ${i}`, source: "apify", lastSeenAt: `${DAY}T06:00:00.000Z` });
      }
    });
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.spike.done).toBe(1);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes.map((n) => n.title)).toEqual(["6 new sellers entered Pet Supplies in DE this week"]);
    expect(notes[0].link).toBe("/dashboard/ad-spy?niche=Pet%20Supplies&country=DE&firstSeen=7");
    await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(1);
  });

  it("C: looks up marketplace best-sellers without ads on Meta's official API, by brand", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "meta_test");
    const searched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) => {
      const url = new URL(String(u));
      if (url.hostname === "graph.facebook.com") {
        searched.push(url.searchParams.get("search_terms") ?? "");
        return new Response(JSON.stringify({
          data: [{ id: "777", page_name: "Corecare", ad_creative_link_titles: ["Instant Posture Corrector"], ad_creative_link_captions: ["corecareshop.com"], ad_delivery_start_time: "2026-09-01" }],
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("products", { ...product, title: "Instant Posture Corrector", category: "Health & Wellness", aiScore: 60, source: "shopify", unitsPerMonth: 800, storeHost: "corecareshop.com" }),
    );
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.backfill).toMatchObject({ done: 1, errors: [] });
    expect(searched).toEqual(["corecareshop"]);
    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads[0]).toMatchObject({ source: "meta_ad_library", landingPageUrl: "https://corecareshop.com", niche: "Health & Wellness" });
    expect((await t.run((ctx) => ctx.db.get("products", id)))?.backfillCheckedAt).toBe(DAY);
    await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(searched).toHaveLength(1); // not searched again for 14 days
  });

  it("reports what isn't set up instead of failing", async () => {
    const t = convexTest(schema, modules);
    await winnerWithAdvertiser(t, "Paw", 95);
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.winner.skipped).toBe("APIFY_TOKEN isn't set");
    expect(r.backfill.skipped).toBe("META_ACCESS_TOKEN isn't set");
  });
});
