/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const ad = {
  advertiserName: "Paws", platform: "Facebook", country: "DK", niche: "Pet Supplies", headline: "", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated", transcript: "Min hund elsker den her seng.", spokenHook: "Min hund elsker den her seng.",
};

afterEach(() => vi.unstubAllGlobals());

describe("transcript translation", () => {
  it("translates once per language, then answers from the ad", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    const adId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      return ctx.db.insert("ads", ad);
    });
    let calls = 0;
    let sent = "";
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      calls++;
      sent = String(init?.body ?? "");
      return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: "My dog loves this bed." }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.action(api.transcriptsAi.translate, { adId, language: "English" })).toEqual({ text: "My dog loves this bed." });
    expect(sent).toContain("Min hund elsker den her seng.");
    expect(await me.action(api.transcriptsAi.translate, { adId, language: "English" })).toEqual({ text: "My dog loves this bed." });
    expect(calls).toBe(1);
    const saved = await t.run(async (ctx) => ctx.db.get("ads", adId));
    expect(saved?.transcriptTranslations).toEqual({ English: "My dog loves this bed." });
  });

  it("refuses unknown languages and ads without a transcript", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    const { adId, bareId } = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" });
      return { adId: await ctx.db.insert("ads", ad), bareId: await ctx.db.insert("ads", { ...ad, transcript: undefined }) };
    });
    const me = t.withIdentity({ subject: "u1|s" });
    await expect(me.action(api.transcriptsAi.translate, { adId, language: "Klingon" })).rejects.toThrow(/language/i);
    await expect(me.action(api.transcriptsAi.translate, { adId: bareId, language: "English" })).rejects.toThrow(/no transcript/i);
    await expect(t.action(api.transcriptsAi.translate, { adId, language: "English" })).rejects.toThrow(/sign in/i);
  });
});
