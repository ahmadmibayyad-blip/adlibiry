/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { resultLimit } from "./lib/billing";

const modules = import.meta.glob("./**/*.ts");
const baseStore = {
  logoUrl: "", niche: "Home & Living", country: "US", platform: "Shopify", estimatedRevenueRange: "Unknown",
  trafficRange: "Unknown", activeAdsCount: 0, bestSellers: [], isHighTraffic: false,
};

describe("free and trial accounts see 10 results per list", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("decides the limit from the subscription", () => {
    expect(resultLimit(null)).toBe(10);
    expect(resultLimit({ role: "user" })).toBe(10);
    expect(resultLimit({ plan: "pro", subscriptionStatus: "trialing" })).toBe(10);
    expect(resultLimit({ plan: "pro", subscriptionStatus: "canceled" })).toBe(10);
    expect(resultLimit({ plan: "pro", subscriptionStatus: "active" })).toBeNull();
    expect(resultLimit({ plan: "starter", subscriptionStatus: "past_due" })).toBeNull();
    expect(resultLimit({ role: "admin" })).toBeNull();
  });

  async function setup(user: { subscriptionStatus?: string; role?: string }) {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: user.role ?? "user", plan: "pro", subscriptionStatus: user.subscriptionStatus });
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("stores", {
          ...baseStore,
          name: `Store ${i}`,
          url: `https://store${i}.example`,
          spottedAt: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
        });
      }
    });
    return t.withIdentity({ subject: "u1|session" });
  }

  const firstPage = { paginationOpts: { numItems: 24, cursor: null } };

  it("caps a trial account at 10 and stops 'load more'", async () => {
    const user = await setup({ subscriptionStatus: "trialing" });
    expect(await user.query(api.billing.myResultLimit, {})).toBe(10);
    const page = await user.query(api.stores.list, firstPage);
    expect(page.page).toHaveLength(10);
    expect(page.isDone).toBe(true);
    const more = await user.query(api.stores.list, { paginationOpts: { numItems: 24, cursor: page.continueCursor } });
    expect(more.page).toHaveLength(0);
  });

  it("shows paying customers everything", async () => {
    const user = await setup({ subscriptionStatus: "active" });
    expect(await user.query(api.billing.myResultLimit, {})).toBeNull();
    const page = await user.query(api.stores.list, firstPage);
    expect(page.page).toHaveLength(24);
    expect(page.isDone).toBe(false);
  });
});
