/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { TRANSCRIBE_RUNS } from "./lib/deepgram";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co", platform: "Facebook", country: "DK", niche: "Pet Supplies", headline: "Mat", bodyText: "",
  creativeUrl: "", landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 10, aiScore: 50,
  targeting: { ageRange: "Unknown", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "apify",
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("transcripts.transcribe", () => {
  it("transcribes on request, falls back to our copy, and keeps to the daily limit", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg_test");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const url = JSON.parse(init.body).url as string;
      calls.push(url);
      if (url.includes("expired")) return new Response(JSON.stringify({ err_msg: "Failed to fetch media" }), { status: 400 });
      const words = [{ word: "Cool", punctuated_word: "Cool", start: 0.2, end: 0.5 }, { word: "dog.", punctuated_word: "dog.", start: 0.6, end: 0.9 }];
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "Cool dog.", words }] }] } }), { status: 200 });
    }));
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1" });
      return {
        expired: await ctx.db.insert("ads", ad({ videoUrl: "https://fbcdn.example/expired.mp4", hostedVideoUrl: "https://convex.example/copy" })),
        done: await ctx.db.insert("ads", ad({ videoUrl: "https://fbcdn.example/a.mp4", transcript: "Already here.", spokenHook: "Already here." })),
        noVideo: await ctx.db.insert("ads", ad({})),
        more: await Promise.all(Array.from({ length: TRANSCRIBE_RUNS.free }, (_, i) => ctx.db.insert("ads", ad({ videoUrl: `https://fbcdn.example/${i}.mp4` })))),
      };
    });
    const me = t.withIdentity({ subject: "u1|s" });

    const r = await me.action(api.transcripts.transcribe, { adId: ids.expired });
    expect(r).toMatchObject({ transcript: "Cool dog.", hook: "Cool dog." });
    expect(calls).toEqual(["https://fbcdn.example/expired.mp4", "https://convex.example/copy"]);
    expect((await t.run((ctx) => ctx.db.get("ads", ids.expired)))?.transcript).toBe("Cool dog.");

    // An ad that already has one costs nothing.
    expect((await me.action(api.transcripts.transcribe, { adId: ids.done })).transcript).toBe("Already here.");
    await expect(me.action(api.transcripts.transcribe, { adId: ids.noVideo })).rejects.toThrow(/no video/);

    // Free accounts: TRANSCRIBE_RUNS.free a day, the first one included.
    for (const id of ids.more.slice(0, TRANSCRIBE_RUNS.free - 1)) await me.action(api.transcripts.transcribe, { adId: id });
    await expect(me.action(api.transcripts.transcribe, { adId: ids.more[TRANSCRIBE_RUNS.free - 1] })).rejects.toThrow(/Upgrade to Pro/);
  });
});
