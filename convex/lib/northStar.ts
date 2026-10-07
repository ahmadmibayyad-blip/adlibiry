// North-star metric (roadmap §5): Weekly Validated Tests per active user. A
// user "advances a test" on a product when, in the same week, they view its
// verdict panel AND save it. Funnel: product opened → verdict viewed → saved →
// supplier opened. Pure, unit tested; convex/events.ts reads the events.

export const EVENT_TYPES = ["product_open", "verdict_view", "product_save", "supplier_click"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventRow = { userId: string; type: string; productId?: string };

export type NorthStar = {
  activeUsers: number;
  validatedTests: number;
  perActiveUser: number;
  funnel: Record<EventType, number>; // distinct user × product pairs at each stage
};

export function northStar(events: EventRow[]): NorthStar {
  const users = new Set<string>();
  const pairs: Record<EventType, Set<string>> = {
    product_open: new Set(),
    verdict_view: new Set(),
    product_save: new Set(),
    supplier_click: new Set(),
  };
  for (const e of events) {
    users.add(e.userId);
    if (e.productId && e.type in pairs) pairs[e.type as EventType].add(`${e.userId}|${e.productId}`);
  }
  let validatedTests = 0;
  for (const pair of pairs.verdict_view) if (pairs.product_save.has(pair)) validatedTests++;
  const funnel = Object.fromEntries(EVENT_TYPES.map((t) => [t, pairs[t].size])) as Record<EventType, number>;
  return {
    activeUsers: users.size,
    validatedTests,
    perActiveUser: users.size ? Math.round((validatedTests / users.size) * 100) / 100 : 0,
    funnel,
  };
}
