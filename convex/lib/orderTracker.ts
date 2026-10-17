// Orders (orders.ts, /dashboard/orders): the store's recent orders as Shopify knows them, whoever ships them: the
// owner's fulfillment app (CJ, DSers, AutoDS, Zendrop...), an agent, or the owner by hand. AdSpy places nothing and
// keeps nothing; it reads status and tracking (read_orders, no customer fields) and points out orders that need a
// look. Pure.

/** Paid but not shipped after this many days: late. */
export const LATE_DAYS = 3;
/** Shipped this many days ago and still not delivered: slow. */
export const SLOW_DAYS = 20;

const ORDERS = `query TrackedOrders($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) { nodes { title quantity } }
      fulfillments(first: 10) {
        createdAt displayStatus deliveredAt
        service { serviceName type }
        trackingInfo(first: 3) { number company url }
      }
      FULFILLMENT_ORDERS
    }
  }
}`;
/** With where Shopify assigned each open order (needs a fulfillment-order scope; ORDERS_QUERY_BASIC is the fallback). */
export const ORDERS_QUERY = ORDERS.replace("FULFILLMENT_ORDERS", "fulfillmentOrders(first: 5) { nodes { status assignedLocation { name } } }");
export const ORDERS_QUERY_BASIC = ORDERS.replace("FULFILLMENT_ORDERS", "");
export const ordersSearch = (sinceIso: string) => `created_at:>='${sinceIso}'`;

export type OrderStatus = "unpaid" | "waiting" | "on_hold" | "partly" | "shipped" | "delivered" | "cancelled";
export type Tracking = { number: string; company?: string; url?: string };
export type TrackedOrder = {
  id: string;
  name: string;
  createdAt: string;
  status: OrderStatus;
  total?: { amount: number; currency: string };
  items: string[];
  itemCount: number;
  /** Who has the order: the fulfillment app or location it's assigned to, or the app that shipped it. */
  handledBy: string[];
  tracking: Tracking[];
  shippedAt?: string;
  deliveredAt?: string;
  /** What needs a look, in plain words. */
  warning?: string;
};

const PAID = new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);
const DELIVERY_PROBLEM = new Set(["FAILURE", "ATTEMPTED_DELIVERY", "NOT_DELIVERED"]);
const days = (from: string, now: number) => Math.floor((now - Date.parse(from)) / 86_400_000);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Fulfillment = {
  createdAt?: string;
  displayStatus?: string | null;
  deliveredAt?: string | null;
  service?: { serviceName?: string; type?: string } | null;
  trackingInfo?: { number?: string | null; company?: string | null; url?: string | null }[];
};
type Node = {
  id?: string;
  name?: string;
  createdAt?: string;
  cancelledAt?: string | null;
  test?: boolean;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  lineItems?: { nodes?: { title?: string; quantity?: number }[] };
  fulfillments?: Fulfillment[];
  fulfillmentOrders?: { nodes?: { status?: string; assignedLocation?: { name?: string } | null }[] };
};

function orderOf(o: Node, now: number): TrackedOrder | null {
  if (typeof o.id !== "string" || o.test) return null;
  const fulfillments = o.fulfillments ?? [];
  const live = fulfillments.filter((f) => f.displayStatus !== "CANCELED");
  const tracking = live.flatMap((f) =>
    (f.trackingInfo ?? []).flatMap((t): Tracking[] =>
      t.number ? [{ number: t.number, ...(t.company ? { company: t.company } : {}), ...(t.url ? { url: t.url } : {}) }] : [],
    ),
  );
  const fs = o.displayFulfillmentStatus ?? "UNFULFILLED";
  const paid = PAID.has(o.displayFinancialStatus ?? "");
  const delivered = live.length > 0 && live.every((f) => f.displayStatus === "DELIVERED" || f.deliveredAt);
  const status: OrderStatus = o.cancelledAt
    ? "cancelled"
    : fs === "FULFILLED"
      ? delivered
        ? "delivered"
        : "shipped"
      : fs === "PARTIALLY_FULFILLED"
        ? "partly"
        : !paid
          ? "unpaid"
          : fs === "ON_HOLD"
            ? "on_hold"
            : "waiting";

  // The fulfillment app that shipped it, else where Shopify assigned what's still open.
  const handledBy = new Set<string>();
  for (const f of live) if (f.service?.type === "THIRD_PARTY" && f.service.serviceName) handledBy.add(f.service.serviceName);
  for (const fo of o.fulfillmentOrders?.nodes ?? []) {
    if (fo.status !== "CLOSED" && fo.status !== "CANCELLED" && fo.assignedLocation?.name) handledBy.add(fo.assignedLocation.name);
  }

  const shippedAt = live.map((f) => f.createdAt).filter((d): d is string => !!d).sort()[0];
  const deliveredAt = delivered ? live.map((f) => f.deliveredAt).filter((d): d is string => !!d).sort().reverse()[0] : undefined;
  const age = o.createdAt ? days(o.createdAt, now) : 0;
  let warning: string | undefined;
  if (live.some((f) => DELIVERY_PROBLEM.has(f.displayStatus ?? ""))) warning = "The carrier reports a delivery problem";
  else if ((status === "waiting" || status === "on_hold" || status === "partly") && age >= LATE_DAYS) {
    warning = `Paid ${plural(age, "day")} ago, ${status === "partly" ? "only partly shipped" : status === "on_hold" ? "on hold" : "not shipped yet"}`;
  } else if ((status === "shipped" || status === "partly") && !tracking.length) warning = "Shipped without a tracking number";
  else if (status === "shipped" && shippedAt && days(shippedAt, now) >= SLOW_DAYS) warning = `On the way for ${plural(days(shippedAt, now), "day")}`;

  const money = o.totalPriceSet?.shopMoney;
  const lines = o.lineItems?.nodes ?? [];
  return {
    id: o.id,
    name: String(o.name ?? ""),
    createdAt: String(o.createdAt ?? ""),
    status,
    ...(money?.amount && money.currencyCode ? { total: { amount: Number(money.amount), currency: money.currencyCode } } : {}),
    items: lines.map((l) => `${(l.quantity ?? 1) > 1 ? `${l.quantity} × ` : ""}${String(l.title ?? "")}`.slice(0, 120)),
    itemCount: lines.reduce((n, l) => n + (l.quantity ?? 1), 0),
    handledBy: [...handledBy],
    tracking,
    ...(shippedAt ? { shippedAt } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(warning ? { warning } : {}),
  };
}

/** The orders in one ORDERS_QUERY page, newest first, without test orders. */
export function trackedOrders(body: unknown, now = Date.now()): { orders: TrackedOrder[]; next: string | null } {
  const conn = (body as { orders?: { nodes?: Node[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } | null)?.orders;
  const orders = (conn?.nodes ?? []).flatMap((o) => orderOf(o, now) ?? []);
  return { orders, next: conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor ? conn.pageInfo.endCursor : null };
}

/** The counts the page leads with, and the fulfillment apps seen shipping orders. */
export function orderSummary(orders: TrackedOrder[]) {
  const count = (s: OrderStatus[]) => orders.filter((o) => s.includes(o.status)).length;
  return {
    toShip: count(["waiting", "on_hold", "partly"]),
    needsLook: orders.filter((o) => o.warning).length,
    onTheWay: count(["shipped"]),
    delivered: count(["delivered"]),
    apps: [...new Set(orders.flatMap((o) => (o.status === "shipped" || o.status === "delivered" || o.status === "partly" ? o.handledBy : [])))],
  };
}
