/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup(role = "user") {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role }));
  await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" }));
  return { t, me: t.withIdentity({ subject: "u1|s" }), other: t.withIdentity({ subject: "u2|s" }) };
}

describe("AI agents", () => {
  it("creates, lists, pauses and deletes a customer's agents", async () => {
    const { me, other } = await setup();
    const id = await me.mutation(api.agents.create, { name: " Pet scout ", goal: "Find rising pet products under $40", niches: ["Pet Supplies", "Not a niche"] });
    const list = await me.query(api.agents.list, {});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Pet scout", niches: ["Pet Supplies"], enabled: true, latest: null });
    expect(await other.query(api.agents.list, {})).toEqual([]);
    await expect(other.mutation(api.agents.remove, { id })).rejects.toThrow(/not found/i);

    await me.mutation(api.agents.update, { id, name: "Pet scout", goal: "Find rising pet products under $40", niches: [], enabled: false });
    expect((await me.query(api.agents.list, {}))[0].enabled).toBe(false);
    await me.mutation(api.agents.remove, { id });
    expect(await me.query(api.agents.list, {})).toEqual([]);
  });

  it("limits customers to 3 agents and checks the goal", async () => {
    const { me } = await setup();
    await expect(me.mutation(api.agents.create, { name: "x", goal: "short", niches: [] })).rejects.toThrow(/at least 10/);
    for (let i = 0; i < 3; i++) await me.mutation(api.agents.create, { name: `a${i}`, goal: "Find winning beauty products", niches: [] });
    await expect(me.mutation(api.agents.create, { name: "a4", goal: "Find winning beauty products", niches: [] })).rejects.toThrow(/up to 3/);
  });

  it("the daily run writes a briefing (an error one without an API key)", async () => {
    const { t, me } = await setup();
    const id = await me.mutation(api.agents.create, { name: "Beauty", goal: "Find winning beauty products", niches: ["Beauty"] });
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await t.action(internal.agentRunner.runOne, { agentId: id });
    } finally {
      if (key) process.env.ANTHROPIC_API_KEY = key;
    }
    const [agent] = await me.query(api.agents.list, {});
    expect(agent.lastStatus).toBe("error");
    expect(agent.latest?.text).toMatch(/ANTHROPIC_API_KEY/);
    expect(await t.query(internal.agents.enabledIds, { limit: 10 })).toEqual([id]);
  });
});
