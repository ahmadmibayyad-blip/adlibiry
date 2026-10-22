import { describe, expect, it } from "vitest";
import { AWAITING_STATUS, findStatusIds, statusBody } from "./sallaApi";

describe("salla order statuses", () => {
  const statuses = [
    { id: 1, name: "بإنتظار الدفع", type: "original", slug: "payment_pending" },
    { id: 2, name: "بإنتظار المراجعة", type: "original", slug: "under_review" },
    { id: 3, name: "قيد التنفيذ", type: "original", slug: "in_progress" },
  ];

  it("finds Salla's under-review status and ours when the store has it", () => {
    expect(findStatusIds(statuses)).toEqual({ underReviewId: 2, awaitingId: undefined });
    const withOurs = [...statuses, { id: 9, name: AWAITING_STATUS.name, type: "custom", slug: "under_review", parent: { id: 2 } }];
    expect(findStatusIds(withOurs)).toEqual({ underReviewId: 2, awaitingId: 9 });
  });

  it("confirms to in_progress and cancels with the items back in stock", () => {
    expect(statusBody("confirmed", "ok")).toEqual({ slug: "in_progress", note: "ok" });
    expect(statusBody("cancelled", "no")).toEqual({ slug: "canceled", note: "no", restore_items: true });
  });
});
