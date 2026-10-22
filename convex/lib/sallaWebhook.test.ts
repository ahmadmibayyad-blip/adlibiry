import { describe, expect, it } from "vitest";
import { codOrderFrom, parseAuthorize, parseSallaEvent, signBody, verifySallaSignature } from "./sallaWebhook";

describe("salla webhook helpers", () => {
  it("accepts a body signed with the current or previous secret, nothing else", async () => {
    const body = '{"event":"order.created","merchant":1}';
    const sig = await signBody(body, "old");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySallaSignature(body, sig.toUpperCase(), ["new", "old"])).toBe(true);
    expect(await verifySallaSignature(body, sig, ["new"])).toBe(false);
    expect(await verifySallaSignature(body + " ", sig, ["old"])).toBe(false);
    expect(await verifySallaSignature(body, null, ["old"])).toBe(false);
  });

  it("reads the envelope with the store id from the top-level merchant", () => {
    expect(parseSallaEvent('{"event":"app.installed","merchant":"42","data":{"x":1}}')).toEqual({
      event: "app.installed", merchant: 42, created_at: undefined, data: { x: 1 },
    });
    expect(parseSallaEvent("not json")).toBeNull();
    expect(parseSallaEvent('{"event":"x"}')).toBeNull();
  });

  it("reads tokens from app.store.authorize and rejects broken ones", () => {
    expect(parseAuthorize({ access_token: "a", refresh_token: "r", expires: 1700000000, scope: "orders.read_write" })).toEqual({
      accessToken: "a", refreshToken: "r", expiresAt: 1700000000000, scope: "orders.read_write",
    });
    expect(parseAuthorize({ access_token: "a", expires: 1 })).toBeNull();
    expect(parseAuthorize({ access_token: "a", refresh_token: "r", expires: "soon" })).toBeNull();
  });

  it("keeps only COD orders, with ids and amount but no customer data", () => {
    const order = {
      id: 1977, reference_id: 25001, payment_method: "cod",
      amounts: { total: { amount: 249, currency: "SAR" } },
      customer: { first_name: "Sara", mobile: 555555555 },
    };
    expect(codOrderFrom(order)).toEqual({ orderId: "1977", referenceId: "25001", total: 249, currency: "SAR" });
    expect(codOrderFrom({ ...order, payment_method: "credit_card" })).toBeNull();
    expect(codOrderFrom({ payment_method: "cod" })).toBeNull();
  });
});
