import { beforeEach, describe, expect, it } from "vitest";
import { REFERRAL_DAYS, clearReferral, firstClick, pendingReferral, saveReferral } from "./referral";

const DAY = 24 * 60 * 60 * 1000;

describe("referral", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the last code for 60 days", () => {
    saveReferral("First", 0);
    saveReferral(" Shop-Tips ", 1000);
    expect(pendingReferral(1000 + REFERRAL_DAYS * DAY)).toBe("shop-tips");
    expect(pendingReferral(1001 + REFERRAL_DAYS * DAY)).toBeNull();
    clearReferral();
    expect(pendingReferral(1000)).toBeNull();
  });

  it("ignores broken saved values", () => {
    localStorage.setItem("adspy-ref", "{nope");
    expect(pendingReferral()).toBeNull();
  });

  it("counts one click per code per browser", () => {
    expect(firstClick("a")).toBe(true);
    expect(firstClick("a")).toBe(false);
    expect(firstClick("b")).toBe(true);
  });
});
