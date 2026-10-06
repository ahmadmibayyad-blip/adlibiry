/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { upsertAuthUser } from "./lib/authUser";
import { safeReturnUrl } from "./lib/billing";

const modules = import.meta.glob("./**/*.ts");

describe("account linking can't be used to take over an account", () => {
  it("a verified Google sign-in removes the password and sessions of an unverified look-alike account", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "owner@x.com" } }); // first user (admin)
      // Someone signs up with the victim's email and a password they know.
      const squatted = await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "victim@gmail.com" } });
      await ctx.db.insert("authAccounts", { userId: squatted, provider: "password", providerAccountId: "victim@gmail.com", secret: "hash" });
      const session = await ctx.db.insert("authSessions", { userId: squatted, expirationTime: Date.now() + 1e9 });
      await ctx.db.insert("authRefreshTokens", { sessionId: session, expirationTime: Date.now() + 1e9 });

      // The real owner later signs in with Google.
      const google = await upsertAuthUser(ctx, {
        existingUserId: null, type: "oauth", profile: { email: "victim@gmail.com", emailVerified: true },
      });
      expect(google).toBe(squatted);
      expect(await ctx.db.query("authAccounts").collect()).toHaveLength(0);
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
      expect(await ctx.db.query("authRefreshTokens").collect()).toHaveLength(0);
    });
  });

  it("keeps the password of an account whose email is already verified", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const user = await ctx.db.insert("users", { email: "me@x.com", emailVerificationTime: 1, role: "user" });
      await ctx.db.insert("authAccounts", { userId: user, provider: "password", providerAccountId: "me@x.com", secret: "hash" });
      expect(await upsertAuthUser(ctx, { existingUserId: null, type: "oauth", profile: { email: "me@x.com", emailVerified: true } })).toBe(user);
      expect(await ctx.db.query("authAccounts").collect()).toHaveLength(1);
    });
  });
});

describe("extension submissions", () => {
  const ad = { submitterVisitorId: "v1", adKey: "meta_1", advertiserName: "Shop", platform: "Facebook", headline: "Buy", bodyText: "Text", creativeUrl: "https://cdn/real.jpg", landingPageUrl: "https://shop.example", sourceUrl: "https://facebook.com", likes: 1 };

  it("lets a repeat sighting refresh numbers and fill gaps, but not swap the content", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.submittedAds.submitFromExtension, ad);
    await t.mutation(internal.submittedAds.submitFromExtension, {
      ...ad, submitterVisitorId: "attacker", creativeUrl: "https://evil/fake.jpg", landingPageUrl: "https://evil.example", likes: 50, countries: ["DK"],
    });
    const [row] = await t.run((ctx) => ctx.db.query("submittedAds").collect());
    expect(row).toMatchObject({ creativeUrl: "https://cdn/real.jpg", landingPageUrl: "https://shop.example", likes: 50, countries: ["DK"], submitterVisitorId: "v1" });
  });

  it("caps new pending ads per 10 minutes across all visitors", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = new Date().toISOString();
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert("submittedAds", { ...ad, adKey: `k${i}`, submitterVisitorId: `v${i}`, status: "pending", submittedAt: now });
      }
    });
    expect(await t.mutation(internal.submittedAds.submitFromExtension, { ...ad, adKey: "new", submitterVisitorId: "fresh" })).toEqual({
      success: false, reason: "rate_limited",
    });
  });
});

describe("MCP keys are for paying customers", () => {
  it("a free or trial account can't create a key", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "trialing" }));
    await expect(t.withIdentity({ subject: "u1|s" }).action(api.mcpKeys.createKey, { name: "x" })).rejects.toThrow(/paid plan/);
  });

  it("a key stops working when its owner stops paying", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" }));
    const { key } = await t.withIdentity({ subject: "u1|s" }).action(api.mcpKeys.createKey, { name: "x" });
    const call = () => t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect((await call()).status).toBe(200);
    await t.run((ctx) => ctx.db.patch("users", userId, { subscriptionStatus: "canceled" }));
    expect((await call()).status).toBe(403);
  });
});

describe("billing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores a Stripe event older than the last one applied", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro");
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", customerId: "cus_1" }));
    const apply = (status: string, eventCreated: number) =>
      t.mutation(internal.billing.applySubscription, { customerId: "cus_1", subscriptionId: "sub_1", status, priceId: "price_pro", eventCreated });
    await apply("canceled", 200);
    expect(await apply("active", 100)).toEqual({ updated: false, reason: "stale_event" });
    expect(await t.withIdentity({ subject: "u1|s" }).query(api.billing.myPlan, {})).toBe("none");
  });

  it("only sends customers back to our own site", () => {
    const site = "https://adspypro.example";
    expect(safeReturnUrl("https://adspypro.example/dashboard?x=1", site, "/dashboard")).toBe("https://adspypro.example/dashboard?x=1");
    expect(safeReturnUrl("https://evil.example/login", site, "/dashboard")).toBe("https://adspypro.example/dashboard");
    expect(safeReturnUrl("not a url", site + "/", "/#pricing")).toBe("https://adspypro.example/#pricing");
  });
});

describe("functions that now need sign-in", () => {
  it("refuses anonymous callers", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.hooks.latest, {})).rejects.toThrow(/sign in/i);
    await expect(t.action(api.saturation.compare.compareCountries, { niche: "Sports", countries: ["US"] })).rejects.toThrow(/sign in/i);
    await expect(t.action(api.pushNotifications.subscribe, { subscription: "{}" })).rejects.toThrow(/sign in/i);
  });
});
