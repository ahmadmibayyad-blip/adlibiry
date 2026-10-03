/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const adBase = {
  advertiserName: "PawCo", platform: "TikTok", country: "US", niche: "Pet Supplies", bodyText: "", creativeUrl: "",
  landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
  targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

afterEach(() => vi.unstubAllGlobals());

describe("hooks of the week", () => {
  it("builds the week's hooks per niche with Claude's labels", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ads", { ...adBase, headline: "POV: your dog finally stops shedding on the couch", views: "2M" });
      await ctx.db.insert("ads", { ...adBase, headline: "Is your cat bored? Try this", views: "500K" });
      await ctx.db.insert("ads", { ...adBase, headline: "tiktok ad", views: "9M" });
      await ctx.db.insert("ads", { ...adBase, niche: "Beauty", headline: "Nobody tells you this about retinol", views: "1M" });
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const niche = String(JSON.parse(String(init.body)).messages[0].content).match(/Niche: (.+)/)?.[1];
      const hooks = niche === "Pet Supplies"
        ? [
            { index: 1, type: "POV / story", why: "Puts the viewer in the moment.", template: "POV: your [pet] finally stops [problem]" },
            { index: 2, type: "Made up type", why: "Asks a question.", template: "Is your [pet] [problem]? Try this" },
          ]
        : [{ index: 1, type: "Shock / curiosity", why: "Promises a secret.", template: "Nobody tells you this about [ingredient]" }];
      return new Response(
        JSON.stringify({
          id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ hooks }) }], usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const r = await t.action(internal.hooksBuilder.buildWeekly, {});
    expect(r).toMatchObject({ niches: 2, hooks: 3, analysed: 3, errors: [] });

    const data = await t.withIdentity({ subject: "test|s" }).query(api.hooks.latest, {});
    expect(data?.week).toBe(r.week);
    const pets = data?.niches.find((n) => n.niche === "Pet Supplies");
    expect(pets?.hooks.map((h) => [h.rank, h.hook, h.type])).toEqual([
      [1, "POV: your dog finally stops shedding on the couch", "POV / story"],
      [2, "Is your cat bored? Try this", "Other"],
    ]);
    expect(pets?.hooks[0].template).toBe("POV: your [pet] finally stops [problem]");
    expect(pets?.hooks[0].ad?.advertiserName).toBe("PawCo");

    // Rebuilding the same week replaces, never duplicates.
    await t.action(internal.hooksBuilder.buildWeekly, {});
    const again = await t.withIdentity({ subject: "test|s" }).query(api.hooks.latest, {});
    expect(again?.niches.find((n) => n.niche === "Pet Supplies")?.hooks).toHaveLength(2);
  });

  it("saves hooks without labels when the AI fails, and Build now is admin-only", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("ads", { ...adBase, headline: "POV: your dog finally stops shedding", views: "2M" });
    });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 400 }));
    await expect(t.withIdentity({ subject: "u1|s" }).action(api.hooksBuilder.buildNow, {})).rejects.toThrow(/Admin/);
    const r = await t.action(internal.hooksBuilder.buildWeekly, {});
    expect(r.errors).toHaveLength(1);
    const data = await t.withIdentity({ subject: "test|s" }).query(api.hooks.latest, {});
    expect(data?.niches[0].hooks[0].hook).toBe("POV: your dog finally stops shedding");
    expect(data?.niches[0].hooks[0].type).toBeUndefined();
  });
});
