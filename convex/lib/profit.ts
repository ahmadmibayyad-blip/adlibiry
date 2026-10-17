// Profit (the /dashboard/profit page and the morning email): each day's orders from the user's Shopify store, minus
// what they cost: product cost (Shopify's "cost per item", else the supplier cost AdSpy knows for products it
// launched, else what a CJ order really cost), shipping, payment fees and the ad spend the user enters.
// Profit, not revenue. Only order totals and items are read, never who bought. Pure: profit.ts calls Shopify.

import { localDay } from "./shopifyOrderApi";

/** Orders of a time range, financial fields only (read_orders; unitCost needs read_inventory). */
export const ORDERS_QUERY = `query ProfitOrders($q: String!, $after: String) {
  shop { ianaTimezone currencyCode }
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalTaxSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes {
          title currentQuantity
          discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
          product { id }
          variant { id inventoryItem { unitCost { amount } } }
        }
      }
    }
  }
}`;

export type OrderItem = { title: string; quantity: number; unitPrice: number; productId?: string; variantId?: string; unitCost?: number };
export type ProfitOrder = { id: string; name: string; createdAt: string; total: number; tax: number; items: OrderItem[] };

const money = (v: unknown) => {
  const n = Number((v as { shopMoney?: { amount?: unknown } } | null)?.shopMoney?.amount);
  return Number.isFinite(n) ? n : 0;
};

/** The orders in a page of ORDERS_QUERY, without cancelled and test orders. */
export function profitOrders(nodes: unknown[]): ProfitOrder[] {
  return nodes.flatMap((x) => {
    const o = x as Record<string, unknown> & { lineItems?: { nodes?: unknown[] } };
    if (typeof o.id !== "string" || o.cancelledAt || o.test) return [];
    const items = (o.lineItems?.nodes ?? []).flatMap((y): OrderItem[] => {
      const i = y as { title?: string; currentQuantity?: number; discountedUnitPriceAfterAllDiscountsSet?: unknown; product?: { id?: string } | null; variant?: { id?: string; inventoryItem?: { unitCost?: { amount?: unknown } | null } | null } | null };
      const quantity = Number(i.currentQuantity ?? 0);
      if (!(quantity > 0)) return []; // removed or refunded
      const cost = Number(i.variant?.inventoryItem?.unitCost?.amount);
      return [{
        title: String(i.title ?? "").slice(0, 120),
        quantity,
        unitPrice: money(i.discountedUnitPriceAfterAllDiscountsSet),
        ...(i.product?.id ? { productId: i.product.id } : {}),
        ...(i.variant?.id ? { variantId: i.variant.id } : {}),
        ...(Number.isFinite(cost) && cost > 0 ? { unitCost: cost } : {}),
      }];
    });
    return [{ id: o.id, name: String(o.name ?? ""), createdAt: String(o.createdAt ?? ""), total: money(o.currentTotalPriceSet), tax: money(o.currentTotalTaxSet), items }];
  });
}

export type ProfitSettings = { feePercent: number; feeFixed: number; shippingPerOrder: number };
export const DEFAULT_PROFIT_SETTINGS: ProfitSettings = { feePercent: 2.9, feeFixed: 0.3, shippingPerOrder: 0 };

export type ProfitDay = {
  day: string;
  orders: number;
  /** What customers paid, without tax (after refunds and edits). */
  revenue: number;
  productCost: number;
  shippingCost: number;
  fees: number;
  /** Items no cost is known for: their cost is missing from productCost. */
  missingCost: number;
  top: { title: string; units: number; revenue: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each day's numbers, by the store's own calendar. `costOf` gives a product's cost per item in the store's currency
 * when Shopify has none (AdSpy launches); `orderCost` what a CJ order really cost (product + postage), which wins.
 */
export function profitDays(
  orders: ProfitOrder[],
  timeZone: string,
  settings: ProfitSettings,
  costOf: (productId: string) => number | undefined,
  orderCost: (orderId: string) => number | undefined,
): ProfitDay[] {
  const days = new Map<string, ProfitDay & { byTitle: Map<string, { units: number; revenue: number }> }>();
  for (const o of orders) {
    const day = localDay(o.createdAt, timeZone);
    const d = days.get(day) ?? { day, orders: 0, revenue: 0, productCost: 0, shippingCost: 0, fees: 0, missingCost: 0, top: [], byTitle: new Map() };
    const revenue = Math.max(0, o.total - o.tax);
    d.orders += 1;
    d.revenue += revenue;
    if (o.total > 0) d.fees += (o.total * settings.feePercent) / 100 + settings.feeFixed;
    const real = orderCost(o.id);
    if (real !== undefined) d.productCost += real; // CJ's bill includes its postage
    else {
      d.shippingCost += settings.shippingPerOrder;
      for (const i of o.items) {
        const unit = i.unitCost ?? (i.productId ? costOf(i.productId) : undefined);
        if (unit === undefined) d.missingCost += i.quantity;
        else d.productCost += unit * i.quantity;
      }
    }
    for (const i of o.items) {
      const t = d.byTitle.get(i.title) ?? { units: 0, revenue: 0 };
      t.units += i.quantity;
      t.revenue += i.unitPrice * i.quantity;
      d.byTitle.set(i.title, t);
    }
    days.set(day, d);
  }
  return [...days.values()]
    .map(({ byTitle, ...d }) => ({
      ...d,
      revenue: r2(d.revenue),
      productCost: r2(d.productCost),
      shippingCost: r2(d.shippingCost),
      fees: r2(d.fees),
      top: [...byTitle.entries()].map(([title, t]) => ({ title, units: t.units, revenue: r2(t.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Profit of a day: revenue minus every cost, ad spend included when entered. */
export const dayProfit = (d: Pick<ProfitDay, "revenue" | "productCost" | "shippingCost" | "fees">, adSpend = 0) =>
  r2(d.revenue - d.productCost - d.shippingCost - d.fees - adSpend);

/** The Shopify search for orders created from `fromIso` up to (not including) `toIso`. */
export const ordersSearch = (fromIso: string, toIso: string) => `created_at:>='${fromIso}' created_at:<'${toIso}'`;
