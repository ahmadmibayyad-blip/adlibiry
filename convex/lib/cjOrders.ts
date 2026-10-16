// Order autopilot (orders.ts): a paid, unfulfilled Shopify order whose items are linked to CJ products waits for
// the user's OK, then becomes a CJ order (createOrderV2); once CJ ships it, its tracking number goes to Shopify,
// which emails the customer. The customer's address is kept only until the order is at CJ. Pure.

/** Paid orders that aren't shipped yet, newest first: what the autopilot looks at (read_orders + customer data). */
export const OPEN_ORDERS_QUERY = `query OpenOrders($q: String!) {
  orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt cancelledAt test email
      shippingAddress { name address1 address2 city province provinceCode zip country countryCodeV2 phone }
      lineItems(first: 50) { nodes { id title unfulfilledQuantity requiresShipping variant { id title product { id } } } }
    }
  }
}`;
export const openOrdersSearch = (sinceIso: string) => `financial_status:paid fulfillment_status:unfulfilled created_at:>='${sinceIso}'`;

export type ShipTo = { name: string; address1: string; address2?: string; city: string; province?: string; zip?: string; country: string; countryCode: string; phone?: string; email?: string };
export type OpenItem = { lineItemId: string; variantId: string; productId?: string; title: string; quantity: number };
export type OpenOrder = { id: string; name: string; createdAt: string; shipTo: ShipTo | null; items: OpenItem[] };

/** The open orders in an OPEN_ORDERS_QUERY answer: only what still has to ship. */
export function openOrders(body: unknown): OpenOrder[] {
  const nodes = (body as { orders?: { nodes?: unknown[] } } | null)?.orders?.nodes ?? [];
  return nodes.flatMap((x): OpenOrder[] => {
    const o = x as Record<string, unknown> & { shippingAddress?: Record<string, string | null> | null; lineItems?: { nodes?: Record<string, unknown>[] } };
    if (typeof o.id !== "string" || o.cancelledAt || o.test) return [];
    const items = (o.lineItems?.nodes ?? []).flatMap((i): OpenItem[] => {
      const variant = i.variant as { id?: string; title?: string; product?: { id?: string } } | null;
      const quantity = Number(i.unfulfilledQuantity ?? 0);
      if (!variant?.id || !(quantity > 0) || i.requiresShipping === false) return [];
      const variantTitle = variant.title && variant.title !== "Default Title" ? ` (${variant.title})` : "";
      return [{ lineItemId: String(i.id), variantId: variant.id, ...(variant.product?.id ? { productId: variant.product.id } : {}), title: `${String(i.title ?? "")}${variantTitle}`.slice(0, 160), quantity }];
    });
    if (!items.length) return [];
    const a = o.shippingAddress;
    const shipTo: ShipTo | null =
      a && a.address1 && a.city && a.countryCodeV2
        ? {
            name: a.name ?? "",
            address1: a.address1,
            ...(a.address2 ? { address2: a.address2 } : {}),
            city: a.city,
            ...(a.province ? { province: a.province } : {}),
            ...(a.zip ? { zip: a.zip } : {}),
            country: a.country ?? a.countryCodeV2,
            countryCode: a.countryCodeV2,
            ...(a.phone ? { phone: a.phone } : {}),
            ...(typeof o.email === "string" && o.email ? { email: o.email } : {}),
          }
        : null;
    return [{ id: o.id, name: String(o.name ?? ""), createdAt: String(o.createdAt ?? ""), shipTo, items }];
  });
}

export type LinkedItem = OpenItem & { cjVid?: string; cjName?: string };

/** The createOrderV2 body. payType 3 makes the order only (the user pays in CJ); 2 pays it from the CJ balance. */
export function cjOrderBody(order: { name: string; shipTo: ShipTo; items: LinkedItem[]; logisticName: string; fromCountryCode: string }, payFromBalance: boolean) {
  const s = order.shipTo;
  return {
    orderNumber: `adspy-${order.name.replace(/[^\w-]/g, "")}-${Date.now().toString(36)}`.slice(0, 50),
    shippingCountryCode: s.countryCode,
    shippingCountry: s.country,
    // CJ needs a province; countries without them (Denmark, Sweden…) give the city.
    shippingProvince: s.province || s.city,
    shippingCity: s.city,
    shippingCustomerName: s.name,
    shippingAddress: s.address1.slice(0, 500),
    ...(s.address2 ? { shippingAddress2: s.address2 } : {}),
    ...(s.zip ? { shippingZip: s.zip } : {}),
    ...(s.phone ? { shippingPhone: s.phone } : {}),
    ...(s.email ? { email: s.email } : {}),
    logisticName: order.logisticName,
    fromCountryCode: order.fromCountryCode,
    remark: `Shopify order ${order.name}`,
    payType: payFromBalance ? 2 : 3,
    products: order.items.filter((i) => i.cjVid).map((i) => ({ vid: i.cjVid, quantity: i.quantity })),
  };
}

/** The CJ order a createOrderV2 answer made: its id and what it costs (USD). */
export function cjOrderMade(body: unknown): { orderId: string; costUsd?: number } | null {
  const d = (body as { result?: boolean; data?: Record<string, unknown> } | null)?.data;
  if (!d || (typeof d.orderId !== "string" && typeof d.orderId !== "number")) return null;
  const cost = Number(d.orderAmount ?? d.actualPayment);
  return { orderId: String(d.orderId), ...(Number.isFinite(cost) && cost > 0 ? { costUsd: Math.round(cost * 100) / 100 } : {}) };
}

export type Tracking = { number: string; company?: string; url?: string };

/** A CJ order's tracking (getOrderDetail), once it has one. */
export function cjTracking(body: unknown): Tracking | null {
  const d = (body as { data?: Record<string, unknown> } | null)?.data;
  const number = typeof d?.trackNumber === "string" ? d.trackNumber.trim() : "";
  if (!number) return null;
  const company = typeof d?.trackingProvider === "string" && d.trackingProvider ? d.trackingProvider : typeof d?.logisticName === "string" ? d.logisticName : undefined;
  const url = typeof d?.trackingUrl === "string" && /^https?:\/\//.test(d.trackingUrl) ? d.trackingUrl : undefined;
  return { number, ...(company ? { company } : {}), ...(url ? { url } : {}) };
}

/** The order's fulfillment orders, to mark the CJ items shipped with tracking. */
export const FULFILLMENT_ORDERS_QUERY = `query FulfillmentOrders($id: ID!) {
  order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status lineItems(first: 50) { nodes { id remainingQuantity lineItem { id } } } } } }
}`;
export const FULFILLMENT_CREATE = `mutation Ship($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;

/** fulfillmentCreate's input: only the line items CJ shipped, with the tracking, telling the customer. */
export function fulfillmentInput(body: unknown, lineItemIds: string[], tracking: Tracking) {
  const want = new Set(lineItemIds);
  const fos = (body as { order?: { fulfillmentOrders?: { nodes?: { id: string; status: string; lineItems?: { nodes?: { id: string; remainingQuantity: number; lineItem?: { id: string } }[] } }[] } } } | null)?.order?.fulfillmentOrders?.nodes ?? [];
  const lineItemsByFulfillmentOrder = fos
    .filter((fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS")
    .map((fo) => ({
      fulfillmentOrderId: fo.id,
      fulfillmentOrderLineItems: (fo.lineItems?.nodes ?? []).filter((l) => l.remainingQuantity > 0 && l.lineItem && want.has(l.lineItem.id)).map((l) => ({ id: l.id, quantity: l.remainingQuantity })),
    }))
    .filter((g) => g.fulfillmentOrderLineItems.length);
  if (!lineItemsByFulfillmentOrder.length) return null;
  return {
    lineItemsByFulfillmentOrder,
    trackingInfo: { number: tracking.number, ...(tracking.company ? { company: tracking.company } : {}), ...(tracking.url ? { url: tracking.url } : {}) },
    notifyCustomer: true,
  };
}
