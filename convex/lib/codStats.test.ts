import { expect, it } from "vitest";
import { errorKind } from "./codStats";

it("names Shopify failures for the dashboard", () => {
  expect(errorKind("no_fulfillment_order: Shopify had no open fulfillment order to hold")).toBe("no_fulfillment_order");
  expect(errorKind("Shopify: Order has already been cancelled")).toBe("shopify");
  expect(errorKind("Shopify token refresh failed (401); open Istilam in Shopify admin")).toBe("shopify");
  expect(errorKind("Salla token refresh failed (401)")).toBe("salla");
});
