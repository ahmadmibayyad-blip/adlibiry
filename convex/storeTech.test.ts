/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { techFromInspection } from "./storeTech";
import { inspectHtml } from "./lib/storeInspect";

const modules = import.meta.glob("./**/*.ts");
const store = (name: string, host: string, spottedAt: string) => ({
  name, url: `https://${host}`, logoUrl: "", niche: "Pet Supplies", country: "DK", platform: "Shopify",
  estimatedRevenueRange: "~$24K/mo", trafficRange: "20K–40K visits/mo", activeAdsCount: 3, isHighTraffic: false,
  spottedAt, host, bestSellers: [],
});
const shopifyHome = (theme: string, app: string) =>
  `<script src="//cdn.shopify.com/s/x.js"></script><script>Shopify.theme = {"name":"x","schema_name":"${theme}","theme_store_id":null};</script>` +
  `<!-- BEGIN app block: shopify://apps/${app}/blocks/embed/1 -->`;

afterEach(() => vi.unstubAllGlobals());

describe("store tech (theme / app / pixel filters)", () => {
  it("reads listed stores' home pages daily, and the Stores filters use it", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
      await ctx.db.insert("stores", store("Paws", "paws.example", "2026-10-01T00:00:00.000Z"));
      await ctx.db.insert("stores", store("Glow", "glow.example", "2026-10-02T00:00:00.000Z"));
      await ctx.db.insert("stores", store("Down", "down.example", "2026-10-03T00:00:00.000Z"));
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.startsWith("https://paws.example")) return new Response(shopifyHome("Dawn", "judgeme"));
      if (url.startsWith("https://glow.example")) return new Response(shopifyHome("Impulse", "kaching-bundles"));
      return new Response("nope", { status: 503 });
    });

    const run = await t.action(internal.storeTech.daily, {});
    expect(run).toEqual({ fetched: 2, updated: 2, errors: [] });

    const user = t.withIdentity({ subject: "u1|s" });
    const names = async (args: object) =>
      (await user.query(api.stores.list, { paginationOpts: { numItems: 20, cursor: null }, ...args })).page.map((s) => s.name).sort();
    expect(await names({ theme: "Dawn" })).toEqual(["Paws"]);
    expect(await names({ app: "Kaching Bundles" })).toEqual(["Glow"]);
    expect(await names({ theme: "Dawn", app: "Kaching Bundles" })).toEqual([]);
    expect(await names({})).toEqual(["Down", "Glow", "Paws"]);

    const options = await user.query(api.stores.techOptions, {});
    expect(options.read).toBe(2);
    expect(options.themes.map((o) => o.value).sort()).toEqual(["Dawn", "Impulse"]);

    // Read stores aren't read again until they're 30 days old.
    expect((await t.query(internal.storeTech.candidates, {})).length).toBe(0);
  });

  it("a failed read keeps what an earlier read found", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("stores", {
        ...store("Paws", "paws.example", "2026-10-01T00:00:00.000Z"),
        tech: { checkedAt: "2026-08-01T00:00:00.000Z", ok: true, theme: "Dawn", apps: ["Judge.me"], pixels: [] },
      }),
    );
    await t.mutation(internal.storeTech.save, { id, tech: { checkedAt: "2026-10-18T00:00:00.000Z", ok: false, apps: [], pixels: [] } });
    const after = await t.run(async (ctx) => ctx.db.get("stores", id));
    expect(after?.tech).toEqual({ checkedAt: "2026-10-18T00:00:00.000Z", ok: true, theme: "Dawn", apps: ["Judge.me"], pixels: [] });
  });

  it("a Store Inspector run fills in the listed store with the same address", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => ctx.db.insert("stores", store("Paws", "paws.example", "2026-10-01T00:00:00.000Z")));
    await t.run(async (ctx) => techFromInspection(ctx, "paws.example", inspectHtml(shopifyHome("Dawn", "judgeme")), "2026-10-18T00:00:00.000Z"));
    const after = await t.run(async (ctx) => ctx.db.get("stores", id));
    expect(after?.tech).toMatchObject({ ok: true, theme: "Dawn", apps: ["Judge.me"] });
  });
});
