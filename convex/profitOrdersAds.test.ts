/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { dayProfit, profitDays, profitOrders } from "./lib/profit";
import { cjOrderBody, cjOrderMade, cjTracking, fulfillmentInput, openOrders } from "./lib/cjOrders";
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

const openOrderNodes = {
  orders: { nodes: [{
    id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-10-15T08:00:00Z", cancelledAt: null, test: false, email: "kim@example.com",
    shippingAddress: { name: "Kim Hansen", address1: "Storgatan 1", address2: null, city: "Malmö", province: null, provinceCode: null, zip: "21111", country: "Sweden", countryCodeV2: "SE", phone: "+4670000000" },
    lineItems: { nodes: [
      { id: "gid://shopify/LineItem/11", title: "Dream Pillow", unfulfilledQuantity: 2, requiresShipping: true, variant: { id: "gid://shopify/ProductVariant/91", title: "White", product: { id: "gid://shopify/Product/9" } } },
      { id: "gid://shopify/LineItem/12", title: "Gift card", unfulfilledQuantity: 1, requiresShipping: false, variant: { id: "gid://shopify/ProductVariant/55", title: "Default Title", product: { id: "gid://shopify/Product/5" } } },
    ] },
  }] },
};

describe("CJ order autopilot", () => {
  it("reads open orders, builds CJ's order, reads tracking and the Shopify fulfillment", () => {
    const [o] = openOrders(openOrderNodes);
    expect(o.items).toEqual([{ lineItemId: "gid://shopify/LineItem/11", variantId: "gid://shopify/ProductVariant/91", productId: "gid://shopify/Product/9", title: "Dream Pillow (White)", quantity: 2 }]); // the gift card doesn't ship
    expect(o.shipTo).toMatchObject({ name: "Kim Hansen", city: "Malmö", countryCode: "SE", email: "kim@example.com" });
    const body = cjOrderBody({ name: "#1001", shipTo: o.shipTo!, items: [{ ...o.items[0], cjVid: "V1" }], logisticName: "CJPacket", fromCountryCode: "CN" }, false);
    expect(body).toMatchObject({ shippingProvince: "Malmö", shippingCountryCode: "SE", payType: 3, products: [{ vid: "V1", quantity: 2 }], logisticName: "CJPacket" });
    expect(cjOrderBody({ name: "#1", shipTo: o.shipTo!, items: [], logisticName: "x", fromCountryCode: "CN" }, true).payType).toBe(2);
    expect(cjOrderMade({ result: true, data: { orderId: "CJ1", orderAmount: 12.4 } })).toEqual({ orderId: "CJ1", costUsd: 12.4 });
    expect(cjTracking({ data: { trackNumber: "" } })).toBeNull();
    expect(cjTracking({ data: { trackNumber: "YT123", trackingProvider: "YunExpress", trackingUrl: "https://t.17track.net/YT123" } })).toEqual({ number: "YT123", company: "YunExpress", url: "https://t.17track.net/YT123" });
    const fos = { order: { fulfillmentOrders: { nodes: [{ id: "FO1", status: "OPEN", lineItems: { nodes: [{ id: "FOL1", remainingQuantity: 2, lineItem: { id: "gid://shopify/LineItem/11" } }, { id: "FOL2", remainingQuantity: 1, lineItem: { id: "gid://shopify/LineItem/99" } }] } }, { id: "FO2", status: "CLOSED", lineItems: { nodes: [] } }] } } };
    expect(fulfillmentInput(fos, ["gid://shopify/LineItem/11"], { number: "YT123" })).toEqual({
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: "FO1", fulfillmentOrderLineItems: [{ id: "FOL1", quantity: 2 }] }], // only CJ's item
      trackingInfo: { number: "YT123" },
      notifyCustomer: true,
    });
  });

  it("brings an order in, waits for the OK, places it at CJ without its address afterwards, and sends the tracking to Shopify", async () => {
    process.env.CJ_API_KEY = "cj-key";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("shopifyConnections", { userId: id, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", via: "oauth", scopes: "read_orders,write_merchant_managed_fulfillment_orders" });
    });
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    let tracking = "";
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      const url = String(u);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/authentication/getAccessToken")) return json({ result: true, data: { accessToken: "AT", refreshToken: "RT" } });
      if (url.endsWith("/logistic/freightCalculate")) return json({ result: true, data: [{ logisticName: "CJPacket Ordinary", logisticPrice: 4.1, logisticAging: "8-15" }] });
      if (url.endsWith("/shopping/order/createOrderV2")) return json({ result: true, data: { orderId: "CJ777", orderAmount: 13.9 } });
      if (url.includes("/shopping/order/getOrderDetail")) return json({ result: true, data: { trackNumber: tracking, trackingProvider: "YunExpress" } });
      if (url.includes("/graphql.json")) {
        if (body.query.includes("OpenOrders")) return json({ data: openOrderNodes });
        if (body.query.includes("FulfillmentOrders")) return json({ data: { order: { fulfillmentOrders: { nodes: [{ id: "FO1", status: "OPEN", lineItems: { nodes: [{ id: "FOL1", remainingQuantity: 2, lineItem: { id: "gid://shopify/LineItem/11" } }] } }] } } } });
        if (body.query.includes("fulfillmentCreate")) return json({ data: { fulfillmentCreate: { fulfillment: { id: "F1", status: "SUCCESS" }, userErrors: [] } } });
      }
      return json({}, 404);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    await me.mutation(api.orders.setSettings, { autopilot: true, payFromBalance: false });
    await settle(t);
    let page = await me.query(api.orders.mine, {});
    expect(page?.orders).toHaveLength(1);
    expect(page?.orders[0]).toMatchObject({ orderName: "#1001", status: "needs_link", shipToLabel: "Malmö, SE" });
    expect(page?.orders[0]).not.toHaveProperty("shipTo"); // the page never gets the address

    await me.mutation(api.orders.link, { shopifyVariantId: "gid://shopify/ProductVariant/91", title: "Dream Pillow (White)", cjPid: "P1", cjVid: "V1", cjName: "Pillow White" });
    await settle(t);
    page = await me.query(api.orders.mine, {});
    expect(page?.orders[0]).toMatchObject({ status: "waiting", shipping: { method: "CJPacket Ordinary", priceUsd: 4.1, from: "CN" } });
    expect(calls.some((c) => c.url.endsWith("createOrderV2"))).toBe(false); // nothing at CJ without the OK

    await me.mutation(api.orders.approve, { id: page!.orders[0]._id });
    await settle(t);
    const order = await t.run((ctx) => ctx.db.query("cjOrders").first());
    expect(order).toMatchObject({ status: "placed", cjOrderId: "CJ777", cjCostUsd: 13.9, paid: false });
    expect(order?.shipTo).toBeUndefined(); // the address is gone once CJ has it
    expect(calls.find((c) => c.url.endsWith("createOrderV2"))?.body).toMatchObject({ payType: 3, shippingCustomerName: "Kim Hansen", products: [{ vid: "V1", quantity: 2 }] });

    expect(await t.action(internal.orders.trackAll, {})).toEqual({ shipped: 0 }); // no tracking yet
    tracking = "YT123";
    expect(await t.action(internal.orders.trackAll, {})).toEqual({ shipped: 1 });
    expect(calls.find((c) => c.body?.query?.toString().includes("fulfillmentCreate"))?.body?.variables).toMatchObject({ fulfillment: { trackingInfo: { number: "YT123", company: "YunExpress" }, notifyCustomer: true } });
    expect(await t.run((ctx) => ctx.db.query("cjOrders").first())).toMatchObject({ status: "shipped", tracking: { number: "YT123" } });
  });

  it("deletes a customer's orders when Shopify asks", async () => {
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
