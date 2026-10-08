/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("Deleting launches", () => {
  it("removes launches, their unused themes and on request their products, and keeps what's live or still used", async () => {
    const calls: { query: string; id: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      const { query, variables } = JSON.parse(String(init?.body));
      calls.push({ query, id: variables.id });
      if (query.includes("theme(id")) return json({ data: { theme: { id: variables.id, role: variables.id.endsWith("/9") ? "MAIN" : "UNPUBLISHED" } } });
      if (query.includes("themeDelete")) return json({ data: { themeDelete: { deletedThemeId: variables.id, userErrors: [] } } });
      return json({ data: { productDelete: { deletedProductId: variables.id, userErrors: [] } } });
    }));
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const otherId = await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      await ctx.db.insert("shopifyConnections", { userId, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z" });
      const productId = await ctx.db.insert("products", {
        title: "Brush", description: "", imageUrl: "", category: "Pets", tags: [], aiScore: 50, saturation: "Low", trend: "Stable", supplierUrl: "",
        adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z",
      });
      const photo = await ctx.storage.store(new Blob(["png"]));
      const base = { userId, productId, shopDomain: "my-store.myshopify.com", language: "Danish", tone: "friendly", publish: "ACTIVE", createdAt: "2026-10-08T00:00:00Z" };
      return {
        test: await ctx.db.insert("launches", { ...base, status: "published", mode: "store", themeId: "gid://shopify/OnlineStoreTheme/1", shopifyProductId: "gid://shopify/Product/1", aiPhotoIds: [photo] }),
        live: await ctx.db.insert("launches", { ...base, status: "published", mode: "store", themeId: "gid://shopify/OnlineStoreTheme/9", shopifyProductId: "gid://shopify/Product/2" }),
        failed: await ctx.db.insert("launches", { ...base, status: "failed", error: "The AI had a problem." }),
        running: await ctx.db.insert("launches", { ...base, status: "publishing" }),
        shared: await ctx.db.insert("launches", { ...base, status: "published", shopifyProductId: "gid://shopify/Product/3" }),
        keeps: await ctx.db.insert("launches", { ...base, status: "published", shopifyProductId: "gid://shopify/Product/3" }),
        others: await ctx.db.insert("launches", { ...base, userId: otherId, status: "failed" }),
        photo,
      };
    });
    const user = t.withIdentity({ subject: "u1|s" });

    const r = await user.action(api.launchCleanup.remove, { launchIds: [ids.test, ids.live, ids.failed, ids.running, ids.shared, ids.others], deleteProducts: true });
    expect(r).toMatchObject({ removed: 4, themesDeleted: 1, productsDeleted: 1 });
    expect(r.notes).toContain("1 launch is still running, so it was kept.");
    expect(r.notes).toContain("A store you made live was kept, with its theme and product.");
    expect(r.notes).toContain("Products another launch still uses were kept.");
    // The live store's theme and product, and the shared product, were never deleted.
    expect(calls.filter((c) => c.query.includes("themeDelete")).map((c) => c.id)).toEqual(["gid://shopify/OnlineStoreTheme/1"]);
    expect(calls.filter((c) => c.query.includes("productDelete")).map((c) => c.id)).toEqual(["gid://shopify/Product/1"]);

    const left = await t.run(async (ctx) => ({
      rows: await Promise.all(Object.entries(ids).filter(([k]) => k !== "photo").map(async ([k, id]) => [k, !!(await ctx.db.get("launches", id as Id<"launches">))])),
      photo: await ctx.storage.get(ids.photo),
    }));
    expect(Object.fromEntries(left.rows)).toEqual({ test: false, live: false, failed: false, running: true, shared: false, keeps: true, others: true });
    expect(left.photo).toBeNull();
  });

  it("leaves Shopify alone unless there's something to delete there", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const t = convexTest(schema, modules);
    const failed = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const productId = await ctx.db.insert("products", {
        title: "x", description: "", imageUrl: "", category: "x", tags: [], aiScore: 1, saturation: "Low", trend: "Stable", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z",
      });
      return ctx.db.insert("launches", { userId, productId, shopDomain: "gone.myshopify.com", status: "failed", language: "English", tone: "bold", publish: "DRAFT", createdAt: "2026-10-08T00:00:00Z" });
    });
    expect(await t.withIdentity({ subject: "u1|s" }).action(api.launchCleanup.remove, { launchIds: [failed] })).toEqual({ removed: 1, themesDeleted: 0, productsDeleted: 0, notes: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
