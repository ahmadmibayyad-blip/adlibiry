import { describe, expect, it } from "vitest";
import { overQuota, proAllowance } from "./launchQuota";

describe("launch quota", () => {
  const launches = [
    { productId: "a", status: "published", mode: "store" },
    { productId: "a", status: "published", mode: "store" }, // same product again: counted once
    { productId: "b", status: "published" },
    { productId: "c", status: "failed", mode: "store" }, // failed: not counted
    { productId: "d", status: "generating", mode: "store" },
  ];

  it("counts products and full stores once each, skipping failed launches", () => {
    expect(proAllowance(launches, 5, 3)).toEqual({ left: 2, limit: 5, storesLeft: 1, storesLimit: 3 });
  });

  it("blocks a new product or a new store past the limit, never a relaunch", () => {
    const full = proAllowance(launches, 3, 2);
    expect(overQuota(launches, "e", "page", full)).toMatch(/launched 3 products/);
    expect(overQuota(launches, "b", "page", full)).toBeNull();
    expect(overQuota(launches, "a", "store", full)).toBeNull();
    expect(overQuota(launches, "b", "store", full)).toMatch(/built 2 full stores/);
    const room = proAllowance(launches, 5, 2);
    expect(overQuota(launches, "e", "page", room)).toBeNull();
    expect(overQuota(launches, "e", "store", room)).toMatch(/full stores/);
  });
});
