/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const adBase = {
  advertiserName: "PawCo", platform: "Facebook", country: "US", niche: "Pet Supplies", headline: "Cooling mat", bodyText: "",
  creativeUrl: "", landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
  targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

// 6 words + 5 words → 2.4 s + 2 s → 5 s estimated.
const variant = {
  title: "t", hook: "h", cta: "c", notes: "",
  lines: [
    { start: 0, end: 2, scene: "Woman talks to camera", onScreenText: "", voiceover: "My dog was always too hot" },
    { start: 2, end: 4, scene: "Close-up of the product", onScreenText: "", voiceover: "This mat keeps him cool" },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Who = { role?: string; plan?: string; subscriptionStatus?: string; proTrialEndsAt?: number };
const PRO: Who = { plan: "pro", subscriptionStatus: "active" };

async function setup(who: Who = PRO, photo = { type: "image/jpeg", bytes: 1000 }) {
  vi.stubEnv("FAL_KEY", "fal-test");
  const t = convexTest(schema, modules);
  const { userId, adId, photoId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...who });
    const adId = await ctx.db.insert("ads", { ...adBase, videoUrl: "https://video.example/ad.mp4" });
    const photoId = await ctx.storage.store(new Blob([new Uint8Array(photo.bytes)], { type: photo.type }));
    return { userId, adId, photoId };
  });
  const me = t.withIdentity({ subject: "u1|s" });
  const args = { adId, variant, actorId: "maya", voiceId: "EXAVITQu4vr4xnSDxMaL", product: "Cooling mat for dogs", productImageId: photoId };
  return { t, me, userId, adId, photoId, args };
}

async function pastRemake(t: ReturnType<typeof convexTest>, userId: Id<"users">, adId: Id<"ads">, photoId: Id<"_storage">, fields: Record<string, unknown>) {
  await t.run((ctx) =>
    ctx.db.insert("remakes", {
      userId, adId, status: "done", actorId: "maya", voiceId: "v", product: "p", productImageId: photoId, segments: [],
      seconds: 0, monthlySeconds: 0, extraSeconds: 0, startedAt: Date.now() - 60 * 60_000, ...fields,
    }),
  );
}

const errorOf = async (p: Promise<unknown>) => {
  const e = (await p.catch((x) => x)) as { data?: { code?: string; message?: string } };
  return e.data;
};

describe("remake.start", () => {
  it("counts playground clips in the seconds used", async () => {
    const { t, me, userId } = await setup();
    await t.run((ctx) => ctx.db.insert("studioClips", { userId, model: "kling-3", prompt: "p", aspect: "9:16", length: 10, status: "done",
      seconds: 10, monthlySeconds: 10, extraSeconds: 0, startedAt: Date.now() - 60_000 }));
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 10 });
  });

  it("won't start while a playground clip is being made", async () => {
    const { t, me, userId, args } = await setup();
    await t.run((ctx) => ctx.db.insert("studioClips", { userId, model: "kling-3", prompt: "p", aspect: "9:16", length: 5, status: "rendering",
      seconds: 5, monthlySeconds: 5, extraSeconds: 0, startedAt: Date.now() }));
    expect(await errorOf(me.mutation(api.remake.start, args))).toMatchObject({ code: "BUSY" });
  });

  it("starts a remake and schedules the pipeline", async () => {
    const { t, me, args } = await setup();
    const id = await me.mutation(api.remake.start, args);
    const row = await t.run((ctx) => ctx.db.get("remakes", id));
    expect(row).toMatchObject({ status: "voicing", seconds: 5, monthlySeconds: 5, extraSeconds: 0, actorId: "maya" });
    expect((row?.segments as { kind: string }[]).map((s) => s.kind)).toEqual(["actor", "product"]);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.map((j) => j.name)).toEqual(["remake:advance"]);
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ limit: 60, used: 5, extra: 0, canBuy: true, pack: { seconds: 30, cents: 900 } });
  });

  it("needs FAL_KEY", async () => {
    const { me, args } = await setup();
    vi.stubEnv("FAL_KEY", "");
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({ code: "NOT_CONFIGURED", message: "AI video isn't switched on yet (FAL_KEY)." });
  });

  it("is a Pro feature", async () => {
    const { me, args } = await setup({});
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({ code: "LIMIT", message: "AI videos come with Pro." });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ limit: 0, canBuy: false });
  });

  it("stops at this month's seconds", async () => {
    const { t, me, userId, adId, photoId, args } = await setup();
    await pastRemake(t, userId, adId, photoId, { monthlySeconds: 58, seconds: 58 });
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({
      code: "LIMIT",
      message: "You have 2 seconds of AI video left. Buy 30 more seconds for €9.",
    });
  });

  it("uses bought seconds after this month's", async () => {
    const { t, me, userId, adId, photoId, args } = await setup();
    await pastRemake(t, userId, adId, photoId, { monthlySeconds: 58, seconds: 58 });
    await t.run((ctx) => ctx.db.insert("remakeTopUps", { paymentIntentId: "pi_1", userId, seconds: 30, amount: 900, currency: "eur", at: Date.now() }));
    const id = await me.mutation(api.remake.start, args);
    expect(await t.run((ctx) => ctx.db.get("remakes", id))).toMatchObject({ monthlySeconds: 2, extraSeconds: 3 });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 60, extra: 27 });
  });

  it("doesn't count failed remakes", async () => {
    const { t, me, userId, adId, photoId } = await setup();
    await pastRemake(t, userId, adId, photoId, { status: "failed", monthlySeconds: 40, extraSeconds: 0, seconds: 40 });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 0 });
  });

  it("makes one video at a time", async () => {
    const { t, me, userId, adId, photoId, args } = await setup();
    await pastRemake(t, userId, adId, photoId, { status: "rendering", startedAt: Date.now() - 60_000 });
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({ code: "BUSY", message: "Your last video is still being made." });
  });

  it("takes a long shot-by-shot script", async () => {
    const { t, me, args } = await setup();
    const lines = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1, scene: "Talks to camera", onScreenText: "", voiceover: "So cool." }));
    const id = await me.mutation(api.remake.start, { ...args, variant: { ...variant, lines } });
    expect((await t.run((ctx) => ctx.db.get("remakes", id)))?.segments).toHaveLength(1);
  });

  it("says when a script has too many lines", async () => {
    const { me, args } = await setup();
    const lines = Array.from({ length: 41 }, (_, i) => ({ start: i, end: i + 1, scene: "x", onScreenText: "", voiceover: "Hi." }));
    expect(await errorOf(me.mutation(api.remake.start, { ...args, variant: { ...variant, lines } }))).toEqual({
      code: "TOO_LONG",
      message: "This script has 41 lines. Keep it to 40 or fewer.",
    });
  });

  it("refuses a script that's too long", async () => {
    const { me, args } = await setup();
    const sixty = Array.from({ length: 60 }, () => "word").join(" "); // 24 s a line
    const long = { ...variant, lines: [0, 1].map((i) => ({ start: i * 24, end: i * 24 + 24, scene: "x", onScreenText: "", voiceover: sixty })) };
    expect(await errorOf(me.mutation(api.remake.start, { ...args, variant: long }))).toEqual({
      code: "TOO_LONG",
      message: "Shorten the script to about 45 seconds.",
    });
  });

  it("refuses a photo over 8 MB", async () => {
    const bad = { code: "BAD_PHOTO", message: "Upload a JPG, PNG or WebP photo under 8 MB." };
    const big = await setup(PRO, { type: "image/png", bytes: 9 * 1024 * 1024 });
    expect(await errorOf(big.me.mutation(api.remake.start, big.args))).toEqual(bad);
  });

  it("only knows the listed actors", async () => {
    const { me, args } = await setup();
    expect(await errorOf(me.mutation(api.remake.start, { ...args, actorId: "taylor" }))).toEqual({
      code: "BAD_REQUEST",
      message: "Pick an actor from the list.",
    });
  });

  it("caps one user's attempts a day, failed ones too", async () => {
    const { t, me, userId, adId, photoId, args } = await setup();
    for (let i = 0; i < 5; i++) await pastRemake(t, userId, adId, photoId, { status: "failed" });
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({
      code: "LIMIT",
      message: "You've started 5 videos today. Try again tomorrow.",
    });
  });

  it("caps all users together per day", async () => {
    const { t, me, userId, adId, photoId, args } = await setup();
    vi.stubEnv("REMAKES_PER_DAY", "1");
    await pastRemake(t, userId, adId, photoId, { status: "done" });
    expect(await errorOf(me.mutation(api.remake.start, args))).toEqual({ code: "LIMIT", message: "AI video is busy today. Try again tomorrow." });
  });
});

describe("remake.latestForAd", () => {
  it("shows a lost remake as failed", async () => {
    const { t, me, userId, adId, photoId } = await setup();
    await pastRemake(t, userId, adId, photoId, { status: "rendering", startedAt: Date.now() - 21 * 60_000 });
    expect(await me.query(api.remake.latestForAd, { adId })).toMatchObject({
      status: "failed",
      error: "The video took too long. Try again; it didn't use your seconds.",
      videoUrl: null,
    });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 0 });
  });

  it("needs sign-in for an upload link", async () => {
    const t = convexTest(schema, modules);
    expect(await errorOf(t.mutation(api.remake.uploadUrl, {}))).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

// Fake ElevenLabs + fal + fal's file host. Each fal job gets its own links; compose answers video_url.
function stubServices(opts: { submitStatus?: number; audioBytes?: number; flakyStatus?: number; failSecondSubmit?: number; clipSeconds?: number } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // only the test drives advance
  vi.stubEnv("ELEVENLABS_API_KEY", "el-test");
  const posts: { model: string; body: unknown }[] = [];
  const calls = { eleven: 0, cancels: [] as string[] };
  let n = 0;
  let flaky = opts.flakyStatus ? 1 : 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (url.includes("api.elevenlabs.io")) {
        calls.eleven++;
        return new Response(new Uint8Array(opts.audioBytes ?? 40_000), { headers: { "content-type": "audio/mpeg" } });
      }
      if (url.endsWith("/cancel") && init?.method === "PUT") {
        calls.cancels.push(url);
        return json({ status: "CANCELLATION_REQUESTED" });
      }
      if (url.startsWith("https://fal.media/")) return new Response(new Uint8Array(100), { headers: { "content-type": "video/mp4" } });
      const m = url.match(/^https:\/\/queue\.fal\.run\/(.+)$/);
      if (m && init?.method === "POST") {
        if (opts.submitStatus) return json({ detail: "refused" }, opts.submitStatus);
        if (opts.failSecondSubmit && posts.length === 1) return json({ detail: "refused" }, opts.failSecondSubmit);
        posts.push({ model: m[1], body: JSON.parse(String(init.body)) });
        const id = `${++n}-${m[1].includes("compose") ? "compose" : "clip"}`;
        return json({ request_id: id, status_url: `https://queue.fal.run/jobs/${id}/status`, response_url: `https://queue.fal.run/jobs/${id}` });
      }
      if (url.endsWith("/status")) {
        if (flaky > 0) {
          flaky--;
          return json({ detail: "busy" }, opts.flakyStatus);
        }
        return json({ status: "COMPLETED" });
      }
      if (url.includes("/jobs/")) return json(url.includes("compose") ? { video_url: "https://fal.media/final.mp4" } : { video: { url: `https://fal.media/${url.split("/").pop()}.mp4` }, ...(opts.clipSeconds ? { duration: opts.clipSeconds } : {}) });
      return json({}, 404);
    }),
  );
  return Object.assign(posts, { calls });
}

const drive = async (t: ReturnType<typeof convexTest>, remakeId: Id<"remakes">, steps: number) => {
  for (let i = 0; i < steps; i++) await t.action(internal.remake.advance, { remakeId });
};

describe("remake.advance", () => {
  it("refuses a voice-over longer than it was charged for, before fal", async () => {
    const { t, me, args } = await setup();
    const posts = stubServices({ audioBytes: 160_000 }); // 10 s a line, 20 s for a 5 s charge
    const remakeId = await me.mutation(api.remake.start, args);
    await drive(t, remakeId, 2);
    expect(await t.run((ctx) => ctx.db.get("remakes", remakeId))).toMatchObject({
      status: "failed",
      error: "The voice-over came out longer than the script. Shorten the lines and try again.",
    });
    expect(posts).toHaveLength(0);
  });

  it("cancels the jobs already sent when a later one is refused", async () => {
    const { t, me, args } = await setup();
    const posts = stubServices({ failSecondSubmit: 422 });
    const remakeId = await me.mutation(api.remake.start, args);
    await drive(t, remakeId, 2);
    expect(await t.run((ctx) => ctx.db.get("remakes", remakeId))).toMatchObject({ status: "failed" });
    expect(posts.calls.cancels).toEqual(["https://queue.fal.run/jobs/1-clip/cancel"]);
  });

  it("keeps waiting through a brief fal error", async () => {
    const { t, me, args } = await setup();
    stubServices({ flakyStatus: 503 });
    const remakeId = await me.mutation(api.remake.start, args);
    await drive(t, remakeId, 5);
    expect(await t.run((ctx) => ctx.db.get("remakes", remakeId))).toMatchObject({ status: "done" });
  });

  it("voices, renders and composes the video", async () => {
    const { t, me, adId, args } = await setup();
    const posts = stubServices({ clipSeconds: 2.6 });
    const remakeId = await me.mutation(api.remake.start, args);
    await drive(t, remakeId, 1);
    expect(posts.calls.eleven).toBe(1); // one line per step, so a step can't outlast Convex's time limit
    expect(posts).toHaveLength(0);
    await drive(t, remakeId, 3);
    const row = await t.run((ctx) => ctx.db.get("remakes", remakeId));
    expect(row).toMatchObject({ status: "done", seconds: 5 });
    expect(row?.videoId).toBeTruthy();
    expect(posts.map((p) => p.model)).toEqual([
      "fal-ai/bytedance/seedance/v1/pro/image-to-video", // product shots first: they're the ones fal may refuse
      "fal-ai/bytedance/omnihuman/v1.5",
      "fal-ai/ffmpeg-api/compose",
    ]);
    expect(posts[1].body).toMatchObject({ resolution: "1080p", prompt: expect.stringMatching(/talking straight to the phone camera/) });
    expect((posts[1].body as { image_url: string }).image_url).toMatch(/\/actors\/maya\.jpg$/);
    expect(posts[0].body).toMatchObject({ duration: "3", resolution: "1080p", aspect_ratio: "9:16" });
    const tracks = (posts[2].body as { tracks: { type: string; keyframes: { timestamp: number; duration: number }[] }[] }).tracks;
    // The actor clip is cut to fal's real length (2.6 s), not the MP3's estimated 2.5 s; its voice too.
    expect(tracks[0].keyframes.map((k) => [k.timestamp, k.duration])).toEqual([[0, 2600], [2600, 2500]]);
    expect(tracks[1].keyframes.map((k) => [k.timestamp, k.duration])).toEqual([[0, 2600], [2600, 2500]]);
    const latest = await me.query(api.remake.latestForAd, { adId });
    expect(latest).toMatchObject({ status: "done", error: null, redoId: remakeId });
    expect(latest?.videoUrl).toBeTruthy();
  });

  it("fails free when fal refuses the photo", async () => {
    const { t, me, args } = await setup();
    stubServices({ submitStatus: 422 });
    const remakeId = await me.mutation(api.remake.start, args);
    await drive(t, remakeId, 2);
    expect(await t.run((ctx) => ctx.db.get("remakes", remakeId))).toMatchObject({
      status: "failed",
      error: "The AI video service refused this photo. Try a plain product photo.",
    });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 0 });
  });

  it("gives up on a video that takes too long", async () => {
    const { t, userId, adId, photoId } = await setup();
    stubServices();
    await pastRemake(t, userId, adId, photoId, { status: "rendering", startedAt: Date.now() - 21 * 60_000 });
    const remakeId = (await t.run((ctx) => ctx.db.query("remakes").first()))!._id;
    await t.action(internal.remake.advance, { remakeId });
    expect(await t.run((ctx) => ctx.db.get("remakes", remakeId))).toMatchObject({
      status: "failed",
      error: "The video took too long. Try again; it didn't use your seconds.",
    });
  });

  it("does nothing more once a remake is finished", async () => {
    const { t, userId, adId, photoId } = await setup();
    const posts = stubServices();
    await pastRemake(t, userId, adId, photoId, { status: "done" });
    const remakeId = (await t.run((ctx) => ctx.db.query("remakes").first()))!._id;
    await t.action(internal.remake.advance, { remakeId });
    expect(posts).toHaveLength(0);
  });
});

describe("remake.redo", () => {
  async function made() {
    const ctx = await setup();
    const posts = stubServices();
    const remakeId = await ctx.me.mutation(api.remake.start, ctx.args);
    await drive(ctx.t, remakeId, 4);
    posts.length = 0;
    posts.calls.eleven = 0;
    return { ...ctx, posts, remakeId };
  }

  it("makes a finished video again once, free, with the recorded voice", async () => {
    const { t, me, adId, posts, remakeId } = await made();
    const again = await me.mutation(api.remake.redo, { remakeId, actorId: "liam" });
    expect(await t.run((ctx) => ctx.db.get("remakes", again))).toMatchObject({
      status: "voicing", actorId: "liam", redoOf: remakeId, monthlySeconds: 0, extraSeconds: 0, freeSeconds: 5,
    });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 5 }); // only the first video's seconds
    await drive(t, again, 4);
    expect(await t.run((ctx) => ctx.db.get("remakes", again))).toMatchObject({ status: "done" });
    expect(posts.calls.eleven).toBe(0);
    expect((posts[1].body as { image_url: string }).image_url).toMatch(/\/actors\/liam\.jpg$/);
    expect(await me.query(api.remake.latestForAd, { adId })).toMatchObject({ redoId: null });
    expect(await errorOf(me.mutation(api.remake.redo, { remakeId }))).toMatchObject({ code: "LIMIT" });
    expect(await errorOf(me.mutation(api.remake.redo, { remakeId: again }))).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("records the lines again for another voice", async () => {
    const { t, me, posts, remakeId } = await made();
    const again = await me.mutation(api.remake.redo, { remakeId, voiceId: "TxGEqnHWrfWFTfGW9XjX" });
    await drive(t, again, 2);
    expect(posts.calls.eleven).toBe(2);
  });

  it("can be tried again when the free redo fails", async () => {
    const { t, me, adId, remakeId } = await made();
    const again = await me.mutation(api.remake.redo, { remakeId });
    await t.run((ctx) => ctx.db.patch("remakes", again, { status: "failed", error: "x" }));
    expect(await me.query(api.remake.latestForAd, { adId })).toMatchObject({ status: "failed", redoId: remakeId });
    await expect(me.mutation(api.remake.redo, { remakeId })).resolves.toBeTruthy();
  });

  it("is only for the owner's finished videos", async () => {
    const { t, me, adId, photoId, args } = await setup();
    stubServices();
    const running = await me.mutation(api.remake.start, args);
    expect(await errorOf(me.mutation(api.remake.redo, { remakeId: running }))).toMatchObject({ code: "BAD_REQUEST" });
    const other = await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u2", role: "user", ...PRO }));
    await pastRemake(t, other, adId, photoId, {});
    const theirs = (await t.run((ctx) => ctx.db.query("remakes").withIndex("by_user", (q) => q.eq("userId", other)).first()))!._id;
    expect(await errorOf(me.mutation(api.remake.redo, { remakeId: theirs }))).toMatchObject({ code: "NOT_FOUND" });
  });
});
