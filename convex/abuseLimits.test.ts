/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { upsertAuthUser } from "./lib/authUser";
import { capLimit } from "./lib/aiTools";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
const trial = { plan: "pro", subscriptionStatus: "trialing" };

describe("AI requests for free accounts", () => {
  it("free accounts get 5 a day, trial accounts the full 30", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "free", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "trial", role: "user", ...trial });
    });
    const free = t.withIdentity({ subject: "free|s" });
    for (let i = 0; i < 5; i++) expect((await free.mutation(internal.assistantUsage.claimMessage, { limit: 30 })).allowed).toBe(true);
    const refused = await free.mutation(internal.assistantUsage.claimMessage, { limit: 30 });
    expect(refused).toMatchObject({ allowed: false, limit: 5 });
    expect(refused.message).toMatch(/Free accounts get 5 AI requests a day/);

    const trialUser = t.withIdentity({ subject: "trial|s" });
    for (let i = 0; i < 6; i++) expect((await trialUser.mutation(internal.assistantUsage.claimMessage, { limit: 30 })).allowed).toBe(true);
  });

  it("all free accounts together share a daily ceiling; trial accounts don't count toward it", async () => {
    vi.stubEnv("AI_FREE_GLOBAL_DAILY_LIMIT", "2");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const id of ["f1", "f2", "f3"]) await ctx.db.insert("users", { tokenIdentifier: id, role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "trial", role: "user", ...trial });
    });
    const claim = (id: string) => t.withIdentity({ subject: `${id}|s` }).mutation(internal.assistantUsage.claimMessage, { limit: 30 });
    expect((await claim("f1")).allowed).toBe(true);
    expect((await claim("f2")).allowed).toBe(true);
    const third = await claim("f3");
    expect(third.allowed).toBe(false);
    expect(third.message).toMatch(/Free AI requests are used up for today/);
    expect((await claim("trial")).allowed).toBe(true);
  });
});

describe("AI agents need a trial or paid plan", () => {
  it("a free account can't create one, and the daily run skips free owners", async () => {
    const t = convexTest(schema, modules);
    const [freeId, trialId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { tokenIdentifier: "free", role: "user" }),
      await ctx.db.insert("users", { tokenIdentifier: "trial", role: "user", ...trial }),
    ]);
    await expect(
      t.withIdentity({ subject: "free|s" }).mutation(api.agents.create, { name: "Watcher", goal: "Find pet products under $30", niches: [] }),
    ).rejects.toThrow(/free trial/);
    const [freeAgent, trialAgent] = await t.run(async (ctx) => {
      const base = { name: "A", goal: "Find products", niches: [], enabled: true, createdAt: "2026-10-01T00:00:00Z" };
      return [await ctx.db.insert("agents", { ...base, userId: freeId }), await ctx.db.insert("agents", { ...base, userId: trialId })];
    });
    const ids = await t.query(internal.agents.enabledIds, { limit: 10 });
    expect(ids).toContain(trialAgent);
    expect(ids).not.toContain(freeAgent);
  });
});

describe("the 10-result cap applies everywhere", () => {
  it("search tools ask for at most the customer's limit", () => {
    expect(capLimit({ limit: 15 }, 10)).toEqual({ limit: 10 });
    expect(capLimit({}, 10)).toEqual({ limit: 8 });
    expect(capLimit({ limit: 15 }, null)).toEqual({ limit: 15 });
  });

  it("a product's ad list shows a trial account 10 ads", async () => {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "trial", role: "user", ...trial });
      const p = await ctx.db.insert("products", {
        title: "Mat", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Unknown",
        trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-09-01T00:00:00.000Z",
      });
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("ads", {
          productId: p, advertiserName: "Shop", platform: "Facebook", country: "US", niche: "Pet Supplies", headline: `Ad ${i}`, bodyText: "",
          creativeUrl: "", landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
          targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
        });
      }
      return p;
    });
    const ads = await t.withIdentity({ subject: "trial|s" }).query(api.history.productAds, { productId });
    expect(ads).toHaveLength(10);
  });
});

describe("account linking cleanup", () => {
  it("a verified Google sign-in also removes a squatter's MCP keys, Shopify store and Stripe customer", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "owner@x.com" } });
      const squatted = await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "victim@gmail.com" } });
      await ctx.db.patch("users", squatted, { customerId: "cus_attacker", plan: "pro", subscriptionStatus: "active", subscriptionId: "sub_x" });
      await ctx.db.insert("mcpKeys", { userId: squatted, name: "k", keyHash: "h", prefix: "asp_xxxxxx", createdAt: "2026-10-01T00:00:00Z" });
      await ctx.db.insert("shopifyConnections", { userId: squatted, shopDomain: "evil.myshopify.com", shopName: "Evil", accessToken: "t", connectedAt: "2026-10-01T00:00:00Z" });

      const google = await upsertAuthUser(ctx, { existingUserId: null, type: "oauth", profile: { email: "victim@gmail.com", emailVerified: true } });
      expect(google).toBe(squatted);
      const user = await ctx.db.get("users", squatted);
      for (const field of ["customerId", "plan", "subscriptionStatus", "subscriptionId"] as const) expect(user?.[field]).toBeUndefined();
      expect((await ctx.db.query("mcpKeys").collect())[0].revokedAt).toBeTypeOf("string");
      expect(await ctx.db.query("shopifyConnections").collect()).toHaveLength(0);
    });
  });
});
