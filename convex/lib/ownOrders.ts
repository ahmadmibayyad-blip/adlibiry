// Orders a launched product got in the user's own store: a demand signal for
// the research verdict (convex/ownOrders.ts reads them from Shopify).

export const ORDER_PAGE = 250;
export const MAX_ORDER_PAGES = 4; // 1000 orders: more than that is "capped"
export const ORDER_DAYS = 30;
export const ORDERS_CACHE_MS = 12 * 3600_000;

/** True only when the granted scopes are known and lack read_orders (pasted tokens have no scope list). */
export function missingOrderScope(granted?: string): boolean {
  if (granted === undefined) return false;
  return !granted.split(",").some((s) => s.trim() === "read_orders");
}

type OrderNodes = { lineItems: { nodes: { product: { id: string } | null }[] } }[];

/** Orders with at least one line item of the product (an order counts once). */
export function countOrdersWith(nodes: OrderNodes, productGid: string): number {
  return nodes.filter((o) => o.lineItems.nodes.some((li) => li.product?.id === productGid)).length;
}
