import { describe, expect, it } from "vitest";
import { codStats, parseParcelCost, readIntrospect } from "./sallaStats";

describe("codStats", () => {
  it("counts answers, no-answer cancels and the money saved", () => {
    const s = codStats([
      { status: "confirmed", answeredAt: 1, total: 199 },
      { status: "confirmed", answeredAt: 1, total: 100.5 },
      { status: "cancelled", answeredAt: 1 },
      { status: "cancelled" },
      { status: "pending" },
      { status: "pending", lastError: "WhatsApp send failed" },
    ], 40);
    expect(s).toMatchObject({
      asked: 6, pending: 2, confirmed: 2, cancelledByCustomer: 1, cancelledNoAnswer: 1, failed: 1,
      saved: 80, confirmedValue: 299.5,
    });
    expect(s.confirmRate).toBe(0.5);
    expect(s.answerRate).toBe(0.75);
  });
  it("has no rates before anything is decided", () => {
    expect(codStats([{ status: "pending" }])).toMatchObject({ confirmRate: null, answerRate: null, saved: 0 });
  });
});

it("takes only sensible parcel costs", () => {
  expect(parseParcelCost(35)).toBe(35);
  expect(parseParcelCost(0)).toBe(0);
  expect(parseParcelCost(-1)).toBeNull();
  expect(parseParcelCost(5000)).toBeNull();
  expect(parseParcelCost(Number.NaN)).toBeNull();
  expect(parseParcelCost("35")).toBeNull();
});

describe("readIntrospect", () => {
  const now = Date.parse("2026-10-24T10:00:00Z");
  it("reads the merchant from data, with exp as an ISO date", () => {
    expect(readIntrospect({ success: true, data: { merchant_id: 212746149, user_id: 5, exp: "2026-10-24T11:00:00Z" } }, now))
      .toEqual({ merchantId: 212746149, userId: 5, expiresAt: Date.parse("2026-10-24T11:00:00Z") });
  });
  it("refuses failures, expired tokens and top-level claims", () => {
    expect(readIntrospect({ success: false, error: { message: "Decryption failed" } }, now)).toBeNull();
    expect(readIntrospect({ success: true, data: { merchant_id: 1, exp: "2026-10-24T09:00:00Z" } }, now)).toBeNull();
    expect(readIntrospect({ success: true, merchant_id: 1 }, now)).toBeNull();
    expect(readIntrospect(null, now)).toBeNull();
  });
});
