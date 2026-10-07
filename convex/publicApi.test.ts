/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup(plan: "pro" | "free" = "pro") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
    const p = { description: "", imageUrl: "", tags: [], saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-09-01T00:00:00.000Z" };
    await ctx.db.insert("products", { ...p, title: "Posture Corrector", category: "Health & Wellness", price: 50, cost: 10, aiScore: 91 });
    await ctx.db.insert("products", { ...p, title: "Lip Oil", category: "Beauty", price: 20, cost: 5, aiScore: 70 });
  });
  const user = t.withIdentity({ subject: "u1|session" });
  const { key } = await user.action(api.mcpKeys.createKey, { name: "Sheet" });
  if (plan === "free") await t.run(async (ctx) => {
    const u = (await ctx.db.query("users").collect())[0];
    await ctx.db.patch("users", u._id, { plan: "free", subscriptionStatus: undefined });
  });
  return { t, key };
}

describe("public REST API", () => {
  it("needs a valid key from a paying account", async () => {
    const { t } = await setup();
    expect((await t.fetch("/v1/products")).status).toBe(401);
    expect((await t.fetch("/v1/products", { headers: { Authorization: "Bearer asp_nope" } })).status).toBe(401);
    const free = await setup("free");
    expect((await free.t.fetch("/v1/products", { headers: { Authorization: `Bearer ${free.key}` } })).status).toBe(403);
  });

  it("returns products filtered by query parameters, typed by the tool's schema", async () => {
    const { t, key } = await setup();
    const res = await t.fetch("/v1/products?category=Beauty&limit=5", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("299");
    const body = await res.json();
    expect(body.data.map((p: { title: string }) => p.title)).toEqual(["Lip Oil"]);
    expect(body.data[0].marginPercent).toBe(75);
    const byUrlKey = await t.fetch(`/v1/products?sort=score&key=${encodeURIComponent(key)}`);
    expect((await byUrlKey.json()).data[0].title).toBe("Posture Corrector");
  });

  it("explains bad parameters, unknown endpoints and the daily limit", async () => {
    const { t, key } = await setup();
    const headers = { Authorization: `Bearer ${key}` };
    const bad = await t.fetch("/v1/products?limit=lots", { headers });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Invalid parameters/);
    expect((await t.fetch("/v1/stores", { headers })).status).toBe(404);
    vi.stubEnv("MCP_DAILY_LIMIT", "1");
    expect((await t.fetch("/v1/niches", { headers })).status).toBe(200);
    expect((await t.fetch("/v1/niches", { headers })).status).toBe(429);
    vi.unstubAllEnvs();
  });
});
