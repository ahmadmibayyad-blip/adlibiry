/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { dayProfit, profitDays, profitOrders } from "./lib/profit";
import { orderSummary, trackedOrders } from "./lib/orderTracker";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const m = (amount: number) => ({ shopMoney: { amount: String(amount), currencyCode: "DKK" } });
afterEach(() => vi.unstubAllGlobals());

const orderNodes = [
  { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-10-15T08:00:00Z", cancelledAt: null, test: false, currentTotalPriceSet: m(500), currentTotalTaxSet: m(100),
    lineItems: { nodes: [{ title: "Dream Pillow", currentQuantity: 2, discountedUnitPriceAfterAllDiscountsSet: m(200), product: { id: "gid://shopify/Product/9" }, variant: { id: "gid://shopify/ProductVariant/91", inventoryItem: { unitCost: null } } }] } },
  { id: "gid://shopify/Order/2", name: "#1002", createdAt: "2026-10-15T22:30:00Z", cancelledAt: null, test: false, currentTotalPriceSet: m(250), currentTotalTaxSet: m(50),
    lineItems: { nodes: [{ title: "Sleep Mask", currentQuantity: 1, discountedUnitPriceAfterAllDiscountsSet: m(200), product: { id: "gid://shopify/Product/7" }, variant: { id: "gid://shopify/ProductVariant/71", inventoryItem: { unitCost: { amount: "30.00" } } } }] } },
  { id: "gid://shopify/Order/3", name: "#1003", createdAt: "2026-10-15T09:00:00Z", cancelledAt: "2026-10-15T10:00:00Z", test: false, currentTotalPriceSet: m(999), currentTotalTaxSet: m(0), lineItems: { nodes: [] } },
  { id: "gid://shopify/Order/4", name: "#1004", createdAt: "2026-10-15T09:00:00Z", cancelledAt: null, test: true, currentTotalPriceSet: m(999), currentTotalTaxSet: m(0), lineItems: { nodes: [] } },
];

describe("profit", () => {
  it("counts each store day: sales without tax, costs, fees, ad spend; skips cancelled and test orders", () => {
    const orders = profitOrders(orderNodes);
    expect(orders.map((o) => o.name)).toEqual(["#1001", "#1002"]);
    // Copenhagen: 22:30 UTC on the 15th is the 16th there.
    const days = profitDays(orders, "Europe/Copenhagen", { feePercent: 2, feeFixed: 1, shippingPerOrder: 10 }, (id) => (id === "gid://shopify/Product/9" ? 60 : undefined), () => undefined);
    expect(days).toEqual([
      { day: "2026-10-15", orders: 1, revenue: 400, productCost: 120, shippingCost: 10, fees: 11, missingCost: 0, top: [{ title: "Dream Pillow", units: 2, revenue: 400 }] },
      { day: "2026-10-16", orders: 1, revenue: 200, productCost: 30, shippingCost: 10, fees: 6, missingCost: 0, top: [{ title: "Sleep Mask", units: 1, revenue: 200 }] },
    ]);
    expect(dayProfit(days[0], 100)).toBe(159);
    // No cost known anywhere: counted as missing, not as zero profit margin.
    const unknown = profitDays(orders.slice(0, 1), "UTC", { feePercent: 0, feeFixed: 0, shippingPerOrder: 0 }, () => undefined, () => undefined);
    expect(unknown[0]).toMatchObject({ productCost: 0, missingCost: 2 });
    // What CJ charged wins over the estimates.
    expect(profitDays(orders.slice(0, 1), "UTC", { feePercent: 0, feeFixed: 0, shippingPerOrder: 10 }, () => 60, () => 95)[0]).toMatchObject({ productCost: 95, shippingCost: 0 });
  });

  it("recounts from Shopify, keeps the ad spend the user typed in, and needs read_orders", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("shopifyConnections", { userId: id, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", via: "oauth", scopes: "read_products,read_orders", currency: "DKK" });
      return id;
    });
    const queries: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      const { variables } = JSON.parse(String(init?.body));
      queries.push(variables.q);
      return json({ data: { shop: { ianaTimezone: "Europe/Copenhagen", currencyCode: "DKK" }, orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: orderNodes } } });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    await me.mutation(api.profit.setAdSpend, { day: "2026-10-15", amount: 100 });
    expect(await me.action(api.profit.refresh, {})).toEqual({ days: 2 });
    expect(queries[0]).toMatch(/^created_at:>='.+' created_at:<'.+'$/);
    const page = await me.query(api.profit.mine, { days: 90 });
    const oct15 = page && "days" in page ? page.days?.find((d) => d.day === "2026-10-15") : undefined;
    expect(oct15).toMatchObject({ orders: 1, revenue: 400, adSpend: 100 });
    // The morning email's line.
    expect(await t.query(internal.profit.yesterdayFor, { userId, day: "2026-10-15" })).toMatchObject({ orders: 1, currency: "DKK", shopName: "My Store" });

    await t.run(async (ctx) => {
      const s = await ctx.db.query("shopifyConnections").first();
      await ctx.db.patch("shopifyConnections", s!._id, { scopes: "read_products" });
    });
    expect(await me.action(api.profit.refresh, {})).toEqual({ skipped: "needs read_orders" });
  });
});

const NOW = Date.parse("2026-10-17T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const shipped = (at: string, extra: Record<string, unknown> = {}) => ({
  createdAt: at, displayStatus: "IN_TRANSIT", deliveredAt: null, service: { serviceName: "CJDropshipping", type: "THIRD_PARTY" },
  trackingInfo: [{ number: "YT123", company: "YunExpress", url: "https://t.17track.net/YT123" }], ...extra,
});
const trackedNodes = {
  orders: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: ago(5), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
        totalPriceSet: { shopMoney: { amount: "349.00", currencyCode: "DKK" } }, lineItems: { nodes: [{ title: "Dream Pillow", quantity: 2 }] }, fulfillments: [],
        fulfillmentOrders: { nodes: [{ status: "OPEN", assignedLocation: { name: "DSers" } }] } },
      { id: "gid://shopify/Order/2", name: "#1002", createdAt: ago(1), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
        lineItems: { nodes: [{ title: "Sleep Mask", quantity: 1 }] }, fulfillments: [], fulfillmentOrders: { nodes: [] } },
      { id: "gid://shopify/Order/3", name: "#1003", createdAt: ago(8), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
        lineItems: { nodes: [{ title: "Dream Pillow", quantity: 1 }] }, fulfillments: [shipped(ago(6))], fulfillmentOrders: { nodes: [{ status: "CLOSED", assignedLocation: { name: "CJDropshipping" } }] } },
      { id: "gid://shopify/Order/4", name: "#1004", createdAt: ago(25), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
        lineItems: { nodes: [] }, fulfillments: [shipped(ago(24), { displayStatus: "DELIVERED", deliveredAt: ago(10) })] },
      { id: "gid://shopify/Order/5", name: "#1005", createdAt: ago(28), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
        lineItems: { nodes: [] }, fulfillments: [shipped(ago(26))] },
      { id: "gid://shopify/Order/6", name: "#1006", createdAt: ago(4), cancelledAt: null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
        lineItems: { nodes: [] }, fulfillments: [shipped(ago(3), { service: { serviceName: "Manual", type: "MANUAL" }, trackingInfo: [] })] },
      { id: "gid://shopify/Order/7", name: "#1007", createdAt: ago(6), cancelledAt: ago(5), test: false, displayFinancialStatus: "REFUNDED", displayFulfillmentStatus: "UNFULFILLED", lineItems: { nodes: [] }, fulfillments: [] },
      { id: "gid://shopify/Order/8", name: "#1008", createdAt: ago(6), cancelledAt: null, test: false, displayFinancialStatus: "PENDING", displayFulfillmentStatus: "UNFULFILLED", lineItems: { nodes: [] }, fulfillments: [] },
      { id: "gid://shopify/Order/9", name: "#1009", createdAt: ago(6), cancelledAt: null, test: true, displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", lineItems: { nodes: [] }, fulfillments: [] },
    ],
  },
};

describe("Orders, whoever fulfills them", () => {
  it("reads status, tracking and who has each order, and flags what needs a look", () => {
    const { orders, next } = trackedOrders(trackedNodes, NOW);
    expect(next).toBeNull();
    const by = Object.fromEntries(orders.map((o) => [o.name, o]));
    expect(Object.keys(by)).not.toContain("#1009"); // test orders don't count
    expect(by["#1001"]).toMatchObject({ status: "waiting", handledBy: ["DSers"], items: ["2 × Dream Pillow"], itemCount: 2, total: { amount: 349, currency: "DKK" }, warning: "Paid 5 days ago, not shipped yet" });
    expect(by["#1002"]).toMatchObject({ status: "waiting" });
    expect(by["#1002"].warning).toBeUndefined(); // one day is normal
    expect(by["#1003"]).toMatchObject({ status: "shipped", handledBy: ["CJDropshipping"], tracking: [{ number: "YT123", company: "YunExpress" }] });
    expect(by["#1003"].warning).toBeUndefined();
    expect(by["#1004"]).toMatchObject({ status: "delivered", deliveredAt: ago(10) });
    expect(by["#1005"]).toMatchObject({ status: "shipped", warning: "On the way for 26 days" });
    expect(by["#1006"]).toMatchObject({ status: "shipped", handledBy: [], warning: "Shipped without a tracking number" });
    expect(by["#1007"].status).toBe("cancelled");
    expect(by["#1008"].status).toBe("unpaid");
    expect(orderSummary(orders)).toEqual({ toShip: 2, needsLook: 3, onTheWay: 3, delivered: 1, apps: ["CJDropshipping"] });
  });

  it("reads the store's orders live from Shopify, without customer fields, and falls back when fulfillment orders aren't allowed", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("shopifyConnections", { userId: id, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", via: "oauth", scopes: "read_orders" });
    });
    const queries: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      queries.push(query);
      if (query.includes("fulfillmentOrders")) return json({ errors: [{ message: "Access denied for fulfillmentOrders field." }] });
      return json({ data: trackedNodes });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.query(api.orders.mine, {})).toEqual({ store: { shopName: "My Store", canUse: true } });
    const r = await me.action(api.orders.load, {});
    expect(r.orders.map((o) => o.name)).toContain("#1001");
    expect(r.capped).toBe(false);
    expect(queries).toHaveLength(2); // tried with fulfillment orders, then without
    for (const q of queries) expect(q).not.toMatch(/shippingAddress|customer|email|phone/);
  });

  it("asks to connect or reconnect the store first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const id = await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      await ctx.db.insert("shopifyConnections", { userId: id, shopDomain: "old.myshopify.com", shopName: "Old", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", via: "oauth", scopes: "write_products" });
    });
    await expect(t.withIdentity({ subject: "u1|s" }).action(api.orders.load, {})).rejects.toThrow(/Connect your Shopify store/);
    await expect(t.withIdentity({ subject: "u2|s" }).action(api.orders.load, {})).rejects.toThrow(/Reconnect your store/);
  });

  it("clears what the old CJ autopilot kept when Shopify asks", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      for (const n of [1, 2]) {
        await ctx.db.insert("cjOrders", { userId, shopDomain: "s.myshopify.com", shopifyOrderId: `gid://shopify/Order/${n}`, orderName: `#${n}`, createdAt: "", status: "waiting", items: [], updatedAt: 0 });
      }
    });
    await t.mutation(internal.orders.redact, { shopDomain: "s.myshopify.com", shopifyOrderIds: ["gid://shopify/Order/1"] });
    expect((await t.run((ctx) => ctx.db.query("cjOrders").collect())).map((o) => o.orderName)).toEqual(["#2"]);
    await t.mutation(internal.orders.redact, { shopDomain: "s.myshopify.com" });
    expect(await t.run((ctx) => ctx.db.query("cjOrders").collect())).toHaveLength(0);
  });
});

describe("ad approval queue", () => {
  it("queues a launch's ads, approves, edits and adds AI variations", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      const productId = await ctx.db.insert("products", {
        title: "Dream Pillow", description: "", imageUrl: "i", category: "Home", tags: [], aiScore: 80, saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
      });
      await ctx.db.insert("launches", {
        userId, productId, shopDomain: "s.myshopify.com", status: "published", language: "Danish", tone: "friendly", publish: "DRAFT", createdAt: "2026-10-01",
        copy: { title: "Dream Pillow", subtitle: "Sov bedre", benefits: ["Blød"], hook: "", howItWorks: [], whatsIncluded: [], faq: [], shippingReturns: "", seo: { title: "", description: "" },
          adKit: [{ angle: "Problem", hook: "Vågner du træt?", primaryText: "Prøv Dream Pillow.", headline: "Sov bedre i nat" }, { angle: "Gift", hook: "Den perfekte gave", primaryText: "Til mor.", headline: "Giv søvn" }] },
        adImages: [{ id: (await ctx.storage.store(new Blob(["x"]))), url: "https://img/0.png", angle: "Problem", ad: 0 }],
      });
    });
    vi.stubGlobal("fetch", async () => json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify({ ads: [{ angle: "Curiosity", hook: "Hemmeligheden bag god søvn", primaryText: "...", headline: "Sov som et barn" }, { angle: "Gift", hook: "Gaven", primaryText: "...", headline: "Giv" }] }) }], usage: { input_tokens: 1, output_tokens: 1 } }));
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.mutation(api.adQueue.importLaunches, {})).toBe(2);
    expect(await me.mutation(api.adQueue.importLaunches, {})).toBe(0); // once
    let q = await me.query(api.adQueue.mine, {});
    expect(q?.counts).toEqual({ pending: 2, approved: 0, rejected: 0 });
    const first = q!.ads.find((a) => a.adIndex === 0)!;
    expect(first).toMatchObject({ hook: "Vågner du træt?", imageUrl: "https://img/0.png", productTitle: "Dream Pillow" });

    await me.mutation(api.adQueue.edit, { id: first._id, hook: "Vågner du træt hver morgen?", primaryText: first.primaryText, headline: first.headline });
    await me.mutation(api.adQueue.decide, { id: first._id, status: "approved" });
    expect(await me.action(api.adQueueAi.variations, { id: first._id })).toEqual({ added: 2 });
    q = await me.query(api.adQueue.mine, { status: "approved" });
    expect(q?.ads[0]).toMatchObject({ hook: "Vågner du træt hver morgen?" });
    expect((await me.query(api.adQueue.mine, {}))?.counts).toEqual({ pending: 3, approved: 1, rejected: 0 });
  });
});
