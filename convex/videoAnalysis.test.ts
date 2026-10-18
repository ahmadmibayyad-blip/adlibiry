/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { ANALYZE_RUNS, cleanVariant, readAnalysis, variantPrompt, variantText } from "./lib/videoAnalysis";

const modules = import.meta.glob("./**/*.ts");

// Trimmed from a real tubetext/video-ad-analyzer row (a HelloFresh ad, 2026-10).
const ROW = {
  durationSeconds: 24,
  summary: "This ad promotes HelloFresh as a convenient meal kit service for couples.",
  hook: { text: "Only cooking for two now? Try HelloFresh.", type: "question", delivered_as: "mixed", why_it_works: "It names the audience." },
  angle: "convenience and variety",
  offer: "10 free meals",
  whyItWorks: "A relatable problem and a clear solution.",
  structure: [
    { beat: "hook", start: 0, end: 2.5, description: "Addressing couples cooking for two." },
    { beat: "cta", start: 20.9, end: 24, description: "Final call to action." },
  ],
  shots: [
    { start: 0, end: 1.2, shot: "close-up", scene: "Cooking pasta in a skillet", action: "stirring pasta", expression: "none", on_screen_text: "Only cooking for two now?", spoken: "Only cooking for two now? Try HelloFresh." },
  ],
  suggestions: ["Test a version for busy parents."],
  pacing: { cutCount: 19, shotCount: 20, avgShotSeconds: 1.2, cutsPerMinute: 47.5, cutTimes: [1.2] },
  cta: { text: "Sign up today to claim the deal.", type: "sign up", time: 20 },
};

const adBase = {
  advertiserName: "PawCo", platform: "Facebook", country: "US", niche: "Pet Supplies", headline: "Cooling mat", bodyText: "",
  creativeUrl: "", landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
  targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readAnalysis", () => {
  it("keeps the parts the ad page shows", () => {
    const a = readAnalysis(ROW)!;
    expect(a.hook).toEqual({ text: "Only cooking for two now? Try HelloFresh.", type: "question", why: "It names the audience." });
    expect(a.structure).toHaveLength(2);
    expect(a.shots[0]).toEqual({
      start: 0, end: 1.2, shot: "close-up", scene: "Cooking pasta in a skillet", action: "stirring pasta",
      onScreenText: "Only cooking for two now?", spoken: "Only cooking for two now? Try HelloFresh.",
    });
    expect(a.pacing).toEqual({ cuts: 19, avgShotSeconds: 1.2 });
    expect(a.cta).toEqual({ text: "Sign up today to claim the deal.", time: 20 });
  });

  it("returns null for a row without an analysis", () => {
    expect(readAnalysis({ status: "failed" })).toBeNull();
    expect(readAnalysis(undefined)).toBeNull();
  });
});

describe("variant script", () => {
  it("puts the winning ad and the user's product in the prompt", () => {
    const p = variantPrompt(readAnalysis(ROW)!, "Cooling mat for dogs", "German", "summer heat");
    expect(p).toContain("Hook (question): Only cooking for two now?");
    expect(p).toContain("0–1.2s [close-up] Cooking pasta in a skillet");
    expect(p).toContain("MY PRODUCT\nCooling mat for dogs");
    expect(p).toContain("Angle I want: summer heat");
    expect(p).toContain("in German");
  });

  it("drops empty lines and formats the copy text", () => {
    const v = cleanVariant({
      title: "Cool dog", hook: "Is your dog panting?", cta: "Get yours", notes: "",
      lines: [
        { start: 0, end: 2.5, scene: "Close-up of a panting dog", onScreenText: "Too hot?", voiceover: "Is your dog panting?" },
        { start: 2.5, end: 3, scene: "", onScreenText: "", voiceover: "" },
      ],
    })!;
    expect(v.lines).toHaveLength(1);
    expect(variantText(v)).toBe("Cool dog\nHook: Is your dog panting?\n\n0:00–0:03  Close-up of a panting dog\n  Text: Too hot?\n  Voice: Is your dog panting?\n\nCTA: Get yours");
    expect(cleanVariant({ lines: [] })).toBeNull();
  });
});

describe("videoAnalysis", () => {
  async function setup(plan: "pro" | "none" = "pro") {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const adId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan, subscriptionStatus: plan === "pro" ? "active" : undefined });
      return ctx.db.insert("ads", { ...adBase, videoUrl: "https://video.example/ad.mp4" });
    });
    return { t, adId, me: t.withIdentity({ subject: "u1|s" }) };
  }

  it("analyses the video once and keeps it for everyone", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("/acts/tubetext~video-ad-analyzer/run-sync-get-dataset-items");
      expect(JSON.parse(String(init.body)).adUrls).toEqual(["https://video.example/ad.mp4"]);
      return new Response(JSON.stringify([ROW]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { t, adId, me } = await setup();
    expect(await me.mutation(api.videoAnalysis.start, { adId })).toEqual({ started: true, left: ANALYZE_RUNS.paid - 1 });
    expect(await me.query(api.videoAnalysis.forAd, { adId })).toMatchObject({ status: "running" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await me.query(api.videoAnalysis.forAd, { adId });
    expect(done?.status).toBe("done");
    expect(done?.result?.angle).toBe("convenience and variety");
    // Done: starting again costs nothing.
    expect(await me.mutation(api.videoAnalysis.start, { adId })).toEqual({ started: false, left: ANALYZE_RUNS.paid - 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves a readable error when Apify fails", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Monthly usage hard limit exceeded", { status: 402 })));
    const { t, adId, me } = await setup();
    await me.mutation(api.videoAnalysis.start, { adId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await me.query(api.videoAnalysis.forAd, { adId })).toMatchObject({ status: "failed", error: expect.stringMatching(/credit/) });
  });

  it("stops at the free daily limit and refuses ads without a video", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const { t, adId, me } = await setup("none");
    const other = await t.run((ctx) => ctx.db.insert("ads", { ...adBase, videoUrl: "https://video.example/b.mp4" }));
    const still = await t.run((ctx) => ctx.db.insert("ads", adBase));
    await me.mutation(api.videoAnalysis.start, { adId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(me.mutation(api.videoAnalysis.start, { adId: other })).rejects.toThrow(/Upgrade to Pro/);
    await expect(me.mutation(api.videoAnalysis.start, { adId: still })).rejects.toThrow(/no video/);
    await expect(t.mutation(api.videoAnalysis.start, { adId })).rejects.toThrow(/sign in/);
  });
});
