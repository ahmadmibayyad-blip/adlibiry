import { describe, expect, it } from "vitest";
import { countOrdersWith, missingOrderScope } from "./ownOrders";

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
});
