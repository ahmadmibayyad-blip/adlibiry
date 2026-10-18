/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { pickCandidates } from "./transcripts";

const modules = import.meta.glob("./**/*.ts");
const ad = (i: number, extra: object = {}) => ({
  advertiserName: `A${i}`, platform: "Facebook", country: "DK", niche: "Pet Supplies", headline: "", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 90 - (i % 80), targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated", ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPGRAM_API_KEY;
});

describe("daily video transcripts", () => {
  it("takes scaling ads first, then the best-scoring others", () => {
    const f = [{ id: 1, scaling: false }, { id: 2, scaling: true }, { id: 3, scaling: false }, { id: 4, scaling: true }];
    expect(pickCandidates(f, 3).map((x) => x.id)).toEqual([2, 4, 1]);
  });

  it("reads the ads page by page (past one page) and transcribes the videos it finds", async () => {
    process.env.DEEPGRAM_API_KEY = "dg";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // 250 image ads, then videos: the videos are only on the second page.
      for (let i = 0; i < 250; i++) await ctx.db.insert("ads", ad(i, { aiScore: 95 }));
      await ctx.db.insert("ads", ad(900, { aiScore: 10, videoUrl: "https://v.example/a.mp4" }));
      await ctx.db.insert("ads", ad(901, { aiScore: 9, videoUrl: "https://v.example/b.mp4", isScaling: true }));
      await ctx.db.insert("ads", ad(902, { aiScore: 8, videoUrl: "https://v.example/c.mp4", transcriptCheckedAt: "2026-10-01T00:00:00.000Z" }));
    });
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)).url);
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "Hello there", words: [] }] }] } }));
    });
    const run = await t.action(internal.transcripts.dailyTranscripts, {});
    expect(run).toMatchObject({ fetched: 2, errors: [] });
    expect(asked).toEqual(["https://v.example/b.mp4", "https://v.example/a.mp4"]); // scaling first; already-checked skipped
    const saved = await t.run(async (ctx) => (await ctx.db.query("ads").collect()).filter((a) => a.transcript).map((a) => a.advertiserName).sort());
    expect(saved).toEqual(["A900", "A901"]);
  });
});
