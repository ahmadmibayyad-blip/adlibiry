/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const prefs = {
  watchedNiches: [], notifyNewWinners: true, notifyNewAdsInNiches: true, notifyTrackedStoreUpdates: true,
  emailDigestEnabled: true, updatedAt: "2026-09-01T00:00:00Z",
};
const product = {
  title: "Mat", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 80, saturation: "Unknown",
  trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: true, publishedAt: "2026-09-01T00:00:00.000Z",
};
const store = {
  logoUrl: "", niche: "Pet Supplies", country: "US", platform: "Shopify", estimatedRevenueRange: "Unknown",
  trafficRange: "Unknown", activeAdsCount: 0, bestSellers: [], isHighTraffic: false, spottedAt: "2026-09-01T00:00:00.000Z",
};

describe("long jobs run as short scheduled steps", () => {
  it("the email digest goes out a page at a time and reaches everyone", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const send = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", send);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("products", product);
      for (let i = 0; i < 250; i++) {
        const userId = await ctx.db.insert("users", { tokenIdentifier: `u${i}`, email: `u${i}@x.com` });
        await ctx.db.insert("alertPreferences", { ...prefs, userId });
      }
    });
    expect(await t.action(internal.emailSender.sendDailyDigest, {})).toEqual({ sent: 100 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(send).toHaveBeenCalledTimes(250);
  });

  it("store sales checks are scheduled one per store instead of run in one action", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200 })));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        const storeId = await ctx.db.insert("stores", { ...store, name: `S${i}`, url: `https://s${i}.example` });
        await ctx.db.insert("trackedStores", { userId: await ctx.db.insert("users", { tokenIdentifier: `t${i}` }), storeId, trackedAt: "2026-09-01T00:00:00Z" });
      }
    });
    const r = await t.action(internal.storeSales.runAll, {});
    expect(r).toEqual({ scheduled: 10 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const stores = await t.run((ctx) => ctx.db.query("stores").collect());
    expect(stores.every((st) => st.salesCheck?.at)).toBe(true);
  });

  it("an Apify dataset is saved in batches, and a dataset that can't be read is marked failed", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    const items = Array.from({ length: 120 }, (_, i) => ({
      ad_archive_id: String(1000 + i), page_name: `Shop ${i}`, snapshot: { body: { text: `Great lamp ${i}` }, title: "Lamp" },
      start_date: 1_790_000_000, is_active: true,
    }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("offset=0") ? items : []), { status: 200 }),
    ));
    const t = convexTest(schema, modules);
    const r = await t.action(internal.apify.importDataset, { datasetId: "d1", country: "DK", niche: "Home & Living" });
    expect(r).toMatchObject({ fetched: 120, created: 120, errors: [] });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    await t.run((ctx) => ctx.db.insert("apifyRuns", { token: "tok", country: "DK", niche: "Home & Living", keyword: "lamp", status: "started", createdAt: "2026-10-01T00:00:00Z" }));
    expect(await t.action(internal.apify.handleWebhook, { token: "tok", datasetId: "missing", eventType: "ACTOR.RUN.SUCCEEDED" })).toEqual({ ok: false });
    const [run] = await t.run((ctx) => ctx.db.query("apifyRuns").collect());
    expect(run.status).toBe("failed");
  });

  it("an Apify run that only wrote an error row (e.g. no credit left) is marked failed with the actor's message", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    const message = '"Maximum charged results" option must be atleast 10 to run this actor';
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("offset=0") ? [{ error: message }] : []), { status: 200 }),
    ));
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("apifyRuns", { token: "tok2", country: "US", niche: "Pet Supplies", keyword: "dog toy", status: "started", createdAt: "2026-10-04T00:00:00Z" }));
    expect(await t.action(internal.apify.handleWebhook, { token: "tok2", datasetId: "d2", eventType: "ACTOR.RUN.SUCCEEDED" })).toEqual({ ok: false });
    const [run] = await t.run((ctx) => ctx.db.query("apifyRuns").collect());
    expect(run).toMatchObject({ status: "failed", result: `Apify actor: ${message}` });
  });
});
