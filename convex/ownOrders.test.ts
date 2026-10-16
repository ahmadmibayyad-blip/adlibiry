/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const P = "gid://shopify/Product/1";
const order = (has: boolean) => ({ lineItems: { nodes: [{ product: { id: has ? P : "gid://shopify/Product/9" } }] } });

async function setup(opts: { scopes?: string; launchShop?: string; ownOrdersAt?: string; ownOrders30d?: number } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    await ctx.db.insert("shopifyConnections", {
      userId, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z",
      via: "oauth", scopes: opts.scopes ?? "write_products,read_orders",
    });
    const productId = await ctx.db.insert("products", {
      title: "Brush", description: "", imageUrl: "", category: "Pets", tags: [], aiScore: 50, saturation: "Low", trend: "Stable", supplierUrl: "",
      adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z",
    });
    const launchId = await ctx.db.insert("launches", {
      userId, productId, shopDomain: opts.launchShop ?? "my-store.myshopify.com", status: "published", language: "Danish", tone: "friendly", publish: "ACTIVE",
      createdAt: "2026-10-08T00:00:00Z", shopifyProductId: P,
      ...(opts.ownOrdersAt ? { ownOrdersAt: opts.ownOrdersAt, ownOrders30d: opts.ownOrders30d } : {}),
    });
    return { userId, productId, launchId };
  });
  return { t, ...ids };
}

describe("Own-store orders", () => {
  it("counts orders of the launched product", async () => {
    const f = vi.fn(async () => json({ data: { orders: { nodes: [order(true), order(true), order(false), order(true)], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    vi.stubGlobal("fetch", f);
    const { t, userId, productId, launchId } = await setup();
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ orders: 3, capped: false });
    expect((await t.run((ctx) => ctx.db.get("launches", launchId)))?.ownOrders30d).toBe(3);
  });

  it("uses the cache under 12 hours", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { t, userId, productId } = await setup({ ownOrdersAt: new Date(Date.now() - 3600_000).toISOString(), ownOrders30d: 5 });
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toMatchObject({ orders: 5 });
    expect(f).not.toHaveBeenCalled();
  });

  it("says no_scope without read_orders", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { t, userId, productId } = await setup({ scopes: "write_products" });
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ reason: "no_scope" });
    expect(f).not.toHaveBeenCalled();
  });

  it("ignores a launch on a different shop", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { t, userId, productId } = await setup({ launchShop: "other.myshopify.com" });
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ reason: "no_launch" });
    expect(f).not.toHaveBeenCalled();
  });

  it("stops at 1000 orders and says so", async () => {
    const f = vi.fn(async () => json({ data: { orders: { nodes: Array.from({ length: 250 }, () => order(true)), pageInfo: { hasNextPage: true, endCursor: "c" } } } }));
    vi.stubGlobal("fetch", f);
    const { t, userId, productId } = await setup();
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ orders: 1000, capped: true });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("returns error when Shopify fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    const { t, userId, productId } = await setup();
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ reason: "error" });
  });

  it("says pasted_token when Shopify refuses a pasted token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ errors: "Access denied for orders field. Required access: read_orders" }, 200)));
    const { t, userId, productId } = await setup({ scopes: undefined });
    await t.run(async (ctx) => {
      const c = await ctx.db.query("shopifyConnections").first();
      await ctx.db.replace("shopifyConnections", c!._id, { userId: c!.userId, shopDomain: c!.shopDomain, shopName: c!.shopName, accessToken: c!.accessToken, connectedAt: c!.connectedAt });
    });
    expect(await t.action(internal.ownOrders.forProduct, { userId, productId })).toEqual({ reason: "pasted_token" });
  });
});
