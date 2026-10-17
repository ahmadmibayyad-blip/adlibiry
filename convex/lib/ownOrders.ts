// Orders a launched product got in the user's own store: a demand signal for
// the research verdict (convex/ownOrders.ts reads them from Shopify).

// Shopify Admin GraphQL rejects any single query whose requested cost is over 1000.
// Cost: a connection costs 2 + first x (cost of one node), an object 1, a scalar 0.
// orders(first: 50) { nodes { lineItems(first: 8) { nodes { product { id } } } } }
//   product = 1; lineItems = 2 + 8 x 1 = 10; one order = 1 + 10 = 11; orders = 2 + 50 x 11 = 552.
export const ORDER_PAGE = 50;
// Line items read per order: an order with more items than this may miss the product and is not counted.
export const ORDER_LINE_ITEMS = 8;
export const MAX_ORDER_PAGES = 20; // 20 x 50 = 1000 orders: more than that is "capped"

/** Requested cost of the orders query for a page of `page` orders with `items` line items each. */
export function requestedCost(page: number, items: number): number {
  const product = 1;
  const lineItems = 2 + items * product;
  const order = 1 + lineItems;
  return 2 + page * order;
}
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
