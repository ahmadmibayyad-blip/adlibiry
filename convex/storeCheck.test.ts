/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    await ctx.db.insert("shopifyConnections", { userId, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z", currency: "DKK" });
    const productId = await ctx.db.insert("products", {
      title: "Roku stick", description: "", imageUrl: "", category: "Electronics", tags: [], aiScore: 50, saturation: "Low", trend: "Stable", supplierUrl: "",
      adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z", isBigBrand: true,
    });
    const launch = { userId, productId, shopDomain: "my-store.myshopify.com", status: "published", language: "Danish", tone: "friendly", publish: "ACTIVE", createdAt: "2026-10-08T00:00:00Z" };
    await ctx.db.insert("launches", { ...launch, shopifyProductId: "gid://shopify/Product/1", mode: "store", facts: { shippingTime: "5–10 dage", returnDays: 30, freeShippingFrom: 299, currency: "DKK" } });
    await ctx.db.insert("launches", { ...launch, shopifyProductId: "gid://shopify/Product/1" }); // a relaunch of the same Shopify product
  });
  return { t, user: t.withIdentity({ subject: "u1|s" }) };
}

describe("Ready to sell?", () => {
  it("checks the connected store against what its launch promised", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url === "https://my-store.myshopify.com/") return new Response('<form method="post" action="/password">', { status: 200, headers: { "Content-Type": "text/html" } });
      const q = String(JSON.parse(String(init?.body)).query);
      queries.push(q);
      if (q.includes("shopPolicies")) return json({ errors: [{ message: "Access denied for shopPolicies field. Required access: `read_legal_policies` access scope." }] });
      if (q.includes("deliveryProfiles")) {
        return json({ data: { deliveryProfiles: { nodes: [{ profileLocationGroups: [{ locationGroupZones: { nodes: [{
          zone: { name: "Danmark", countries: [{ code: { countryCode: "DK", restOfWorld: false } }] },
          methodDefinitions: { nodes: [
            { name: "Standard", active: true, description: null, rateProvider: { price: { amount: "55.0" } }, methodConditions: [] },
            { name: "Fri fragt", active: true, description: null, rateProvider: { price: { amount: "0.0" } }, methodConditions: [{ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "249.0" } }] },
          ] },
        }] } }] }] } } });
      }
      if (q.includes("product(id:")) return json({ data: { p0: { id: "gid://shopify/Product/1", title: "Roku stick", status: "ACTIVE", featuredImage: null } } });
      return json({ data: { shop: { plan: { displayName: "Basic", partnerDevelopment: false }, billingAddress: { countryCodeV2: "DK" } }, themes: { nodes: Array.from({ length: 19 }, (_, i) => ({ id: `t${i}` })) } } });
    }));
    const { user } = await setup();
    const { shopDomain, items } = await user.action(api.storeCheck.run, {});
    expect(shopDomain).toBe("my-store.myshopify.com");
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.password).toMatchObject({ status: "fix", fixUrl: "https://admin.shopify.com/store/my-store/online_store/preferences" });
    expect(byId["free-shipping"].detail).toContain("from 299 DKK, but Shopify gives it from 249 DKK");
    expect(byId["delivery-time"]).toMatchObject({ status: "check", title: "Check your delivery times say 5–10 business days" });
    expect(byId.policies.status).toBe("reconnect"); // no read_legal_policies yet
    expect(byId["brand:Roku stick"].status).toBe("fix");
    expect(byId["photo:Roku stick"].status).toBe("fix");
    expect(byId.themes.title).toBe("19 of 20 themes used");
    expect(byId.plan).toMatchObject({ status: "ok", title: "Shopify plan: Basic" });
    expect(queries.filter((q) => q.includes("product(id:"))).toHaveLength(1); // the relaunch shares the product
  });

  it("needs a connected store", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" }));
    await expect(t.withIdentity({ subject: "u2|s" }).action(api.storeCheck.run, {})).rejects.toThrow(/Connect your Shopify store/);
  });
});
