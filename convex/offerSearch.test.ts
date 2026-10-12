/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { FREE_SEARCHES_PER_DAY } from "./offerSearch";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup(plan: "free" | "pro" = "pro") {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...(plan === "pro" ? { plan: "pro", subscriptionStatus: "active" } : {}) }),
  );
  return { t, user: t.withIdentity({ subject: "u1|s" }) };
}

const DAY = 86_400_000;
const items = [
  { ad_archive_id: "1", page_id: "77", page_name: "PawTech", start_date: (Date.now() - 30 * DAY) / 1000, collation_count: 3, snapshot: { body: { text: "Køb 2 få 1 gratis 🐾" }, link_url: "https://pawtech.dk/products/seat" } },
  { ad_archive_id: "2", page_name: "PawTech", start_date: (Date.now() - 5 * DAY) / 1000, snapshot: { body: { text: "Gratis fragt" }, link_url: "https://www.pawtech.dk/" } },
  { ad_archive_id: "3", page_name: "Helysta", start_date: (Date.now() - 60 * DAY) / 1000, snapshot: { body: { text: "Køb 1 få 1 gratis" }, link_url: "https://helysta.dk/products/pude" } },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Offer Search", () => {
  it("searches the offer in Danish through Apify, groups the ads by store, and answers the same search from the last one", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    const runInputs: { urls: { url: string }[]; limitPerSource: number }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/")) {
        runInputs.push(JSON.parse(String(init?.body)));
        return json({ data: { id: "run1", status: "RUNNING" } });
      }
      if (url.includes("/datasets/ds1/items")) return json(items);
      if (url.includes("/actor-runs/run1")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.05 } });
      if (url === "https://pawtech.dk/products.json?limit=1") return json({ products: [{ id: 1 }] });
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup();
    const { id, cached } = await user.action(api.offerSearch.start, { offer: "bxgy", country: "DK" });
    expect(cached).toBe(false);
    // Both Danish phrases, in one run.
    expect(runInputs[0].urls.map((x) => decodeURIComponent(x.url))).toEqual([
      expect.stringContaining("q=køb+2+få+1+gratis"),
      expect.stringContaining("q=køb+1+få+1+gratis"),
    ]);
    expect(runInputs[0].limitPerSource).toBe(75);
    expect(await user.query(api.offerSearch.get, { id })).toMatchObject({ status: "running", country: "DK" });

    // Apify calls the webhook when the run is done.
    const run = await t.run(async (ctx) => (await ctx.db.query("apifyRuns").collect())[0]);
    expect(run).toMatchObject({ trigger: "offer", country: "DK" });
    await t.action(internal.apify.handleWebhook, { token: run.token, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    const done = await user.query(api.offerSearch.get, { id });
    expect(done).toMatchObject({ status: "done", adsFound: 3 });
    expect(done!.stores.map((s) => [s.host, s.ads, s.shopify])).toEqual([
      ["pawtech.dk", 2, true],
      ["helysta.dk", 1, false],
    ]);
    expect(done!.stores[0].offers.map((o) => o.label)).toEqual(expect.arrayContaining(["Buy 2 get 1", "Free shipping"]));
    // The ads also land in Ad Spy.
    expect(await t.run(async (ctx) => (await ctx.db.query("ads").collect()).length)).toBe(3);

    // The same search again: answered from the last one, no new run, and it doesn't count against the limit.
    const again = await user.action(api.offerSearch.start, { offer: "bxgy", country: "dk" });
    expect(again.cached).toBe(true);
    expect(runInputs).toHaveLength(1);
    expect(await user.query(api.offerSearch.get, { id: again.id })).toMatchObject({ status: "done", adsFound: 3 });
    expect(await user.query(api.offerSearch.recent, {})).toMatchObject({ used: 1 });
  });

  it("finishes from Apify itself when the webhook doesn't come, and keeps free accounts to their daily searches", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test");
    let runs = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.apify.com/v2/acts/")) return json({ data: { id: `run${++runs}`, status: "RUNNING" } });
      if (url.includes("/actor-runs/run1")) return json({ data: { status: "SUCCEEDED", defaultDatasetId: "ds1" } });
      if (url.includes("/datasets/ds1/items")) return json(items.slice(2));
      return new Response("", { status: 404 });
    }));
    const { t, user } = await setup("free");
    const first = await user.action(api.offerSearch.start, { offer: "free_shipping", country: "SE" });
    const token = (await t.run(async (ctx) => (await ctx.db.get("offerSearches", first.id))!.runToken))!;
    await t.action(internal.offerSearch.checkRun, { runToken: token, attempt: 1 });
    expect(await user.query(api.offerSearch.get, { id: first.id })).toMatchObject({ status: "done", adsFound: 1 });

    for (let i = 1; i < FREE_SEARCHES_PER_DAY; i++) await user.action(api.offerSearch.start, { offer: "free_shipping", country: "SE", extra: `ord${i}` });
    await expect(user.action(api.offerSearch.start, { offer: "percent", country: "NO" })).rejects.toThrow(/Free accounts get 3 offer searches a day/);
    await expect(user.action(api.offerSearch.start, { country: "XX", offer: "bxgy" })).rejects.toThrow(/listed countries/);
  });
});
