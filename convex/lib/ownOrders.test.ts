import { describe, expect, it } from "vitest";
import { countOrdersWith, missingOrderScope, requestedCost, ORDER_PAGE, ORDER_LINE_ITEMS, MAX_ORDER_PAGES } from "./ownOrders";

const line = (id: string | null) => ({ product: id ? { id } : null });
const P = "gid://shopify/Product/1";

describe("own-store orders", () => {
  it("counts orders containing the product, once each", () => {
    const nodes = [
      { lineItems: { nodes: [line(P), line(P)] } },
      { lineItems: { nodes: [line("gid://shopify/Product/2"), line(null)] } },
      { lineItems: { nodes: [line("gid://shopify/Product/2"), line(P)] } },
    ];
    expect(countOrdersWith(nodes, P)).toBe(2);
  });

  it("flags a missing read_orders scope only when scopes are known", () => {
    expect(missingOrderScope("write_products")).toBe(true);
    expect(missingOrderScope("write_products,read_orders")).toBe(false);
    expect(missingOrderScope(undefined)).toBe(false);
  });

  it("keeps the orders query under Shopify's 1000-point single query limit", () => {
    expect(ORDER_PAGE).toBe(50);
    expect(ORDER_LINE_ITEMS).toBe(8);
    expect(MAX_ORDER_PAGES).toBe(20);
    expect(requestedCost(ORDER_PAGE, ORDER_LINE_ITEMS)).toBe(552);
    expect(requestedCost(ORDER_PAGE, ORDER_LINE_ITEMS)).toBeLessThanOrEqual(1000);
    expect(ORDER_PAGE * MAX_ORDER_PAGES).toBe(1000);
    // the old 250 x 50 shape was ~25,000 points and rejected by Shopify
    expect(requestedCost(250, 50)).toBeGreaterThan(1000);
  });
});
