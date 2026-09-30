/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup(role = "user") {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role });
    await ctx.db.insert("products", {
      title: "ProGrip Posture Corrector",
      description: "Posture corrector",
      imageUrl: "https://cdn.example.com/p.jpg",
      price: 50,
      cost: 10,
      category: "Health & Wellness",
      tags: [],
      aiScore: 91,
      saturation: "Low",
      trend: "Rising",
      supplierUrl: "",
      adExamples: [],
      isWinnerOfDay: true,
      publishedAt: "2026-09-01T00:00:00.000Z",
    });
  });
  const user = t.withIdentity({ subject: "u1|session" });
  const { key } = await user.action(api.mcpKeys.createKey, { name: "Claude" });
  return { t, user, key };
}

const rpc = (id: number, method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

describe("MCP server", () => {
  it("needs a valid key", async () => {
    const { t } = await setup();
    const none = await t.fetch("/mcp", { method: "POST", body: rpc(1, "tools/list") });
    expect(none.status).toBe(401);
    const bad = await t.fetch("/mcp", { method: "POST", headers: { Authorization: "Bearer asp_nope" }, body: rpc(1, "tools/list") });
    expect(bad.status).toBe(401);
  });

  it("initializes, lists tools and answers a tool call", async () => {
    const { t, key } = await setup();
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    const init = await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }) })).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();

    const ack = await t.fetch("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(ack.status).toBe(202);

    const list = await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(2, "tools/list") })).json();
    expect(list.result.tools.map((x: { name: string }) => x.name)).toEqual(["search_ads", "search_products", "list_niches"]);
    expect(list.result.tools[1].inputSchema.type).toBe("object");

    const call = await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(3, "tools/call", { name: "search_products", arguments: { limit: 5 } }) })).json();
    const products = JSON.parse(call.result.content[0].text);
    expect(products[0]).toMatchObject({ title: "ProGrip Posture Corrector", marginPercent: 80 });

    const invalid = await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(4, "tools/call", { name: "search_products", arguments: { limit: 500 } }) })).json();
    expect(invalid.result.isError).toBe(true);

    const unknown = await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(5, "nope") })).json();
    expect(unknown.error.code).toBe(-32601);
  });

  it("accepts the key in the URL for apps that only take a URL", async () => {
    const { t, key } = await setup();
    const res = await t.fetch(`/mcp?key=${encodeURIComponent(key)}`, { method: "POST", body: rpc(1, "ping") });
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("stops working once the key is deleted", async () => {
    const { t, user, key } = await setup();
    const [k] = await user.query(api.mcpKeys.listMyKeys, {});
    expect(k.prefix).toBe(key.slice(0, 10));
    await user.mutation(api.mcpKeys.revokeKey, { id: k._id });
    const res = await t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: rpc(1, "ping") });
    expect(res.status).toBe(401);
    expect(await user.query(api.mcpKeys.listMyKeys, {})).toEqual([]);
  });

  it("caps tool calls per day", async () => {
    process.env.MCP_DAILY_LIMIT = "2";
    try {
      const { t, key } = await setup();
      const headers = { Authorization: `Bearer ${key}` };
      const call = async (id: number) =>
        (await (await t.fetch("/mcp", { method: "POST", headers, body: rpc(id, "tools/call", { name: "list_niches", arguments: {} }) })).json()).result;
      expect((await call(1)).isError).toBeUndefined();
      expect((await call(2)).isError).toBeUndefined();
      expect((await call(3)).content[0].text).toMatch(/Daily limit/);
    } finally {
      delete process.env.MCP_DAILY_LIMIT;
    }
  });

  it("does not let one user delete another user's key", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
    });
    const [k] = await t.withIdentity({ subject: "u1|session" }).query(api.mcpKeys.listMyKeys, {});
    await expect(t.withIdentity({ subject: "u2|session" }).mutation(api.mcpKeys.revokeKey, { id: k._id })).rejects.toThrow();
  });
});
