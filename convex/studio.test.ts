/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Who = { role?: string; plan?: string; subscriptionStatus?: string };
const PRO: Who = { plan: "pro", subscriptionStatus: "active" };
const clip = { model: "kling-3", prompt: "A dog lies on a cooling mat, slow push in", aspect: "9:16", length: 5 };

async function setup(who: Who = PRO) {
  vi.stubEnv("FAL_KEY", "fal-test");
  const t = convexTest(schema, modules);
  const { userId, photoId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...who });
    const photoId = await ctx.storage.store(new Blob([new Uint8Array(1000)], { type: "image/jpeg" }));
    return { userId, photoId };
  });
  return { t, me: t.withIdentity({ subject: "u1|s" }), userId, photoId };
}

/** fal's queue: submit, status, result, and the MP4 download. Records each submit. */
function stubFal(opts: { submitStatus?: number } = {}) {
  const posts: { model: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://fal.media/")) return new Response(new Uint8Array(100), { headers: { "content-type": "video/mp4" } });
      if (url.endsWith("/cancel")) return json({ status: "CANCELLATION_REQUESTED" });
      const m = url.match(/^https:\/\/queue\.fal\.run\/(.+)$/);
      if (m && init?.method === "POST") {
        if (opts.submitStatus) return json({ detail: "refused" }, opts.submitStatus);
        posts.push({ model: m[1], body: JSON.parse(String(init.body)) });
        const id = `${++n}`;
        return json({ request_id: id, status_url: `https://queue.fal.run/jobs/${id}/status`, response_url: `https://queue.fal.run/jobs/${id}` });
      }
      if (url.endsWith("/status")) return json({ status: "COMPLETED" });
      if (url.includes("/jobs/")) return json({ video: { url: `https://fal.media/${url.split("/").pop()}.mp4` } });
      return json({}, 404);
    }),
  );
  return posts;
}

const drive = async (t: ReturnType<typeof convexTest>, clipId: Id<"studioClips">, steps: number) => {
  for (let i = 0; i < steps; i++) await t.action(internal.studio.advance, { clipId });
};

const errorOf = async (p: Promise<unknown>) => {
  const e = (await p.catch((x) => x)) as { data?: { code?: string; message?: string } };
  return e.data;
};

describe("studio.start", () => {
  it("starts a clip, charges length × multiplier, and schedules advance", async () => {
    const { t, me } = await setup();
    const id = await me.mutation(api.studio.start, { ...clip, model: "kling-2.5" });
    expect(await t.run((ctx) => ctx.db.get("studioClips", id))).toMatchObject({ status: "rendering", seconds: 3, monthlySeconds: 3, extraSeconds: 0 });
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.map((j) => j.name)).toEqual(["studio:advance"]);
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 3 });
  });

  it("has its own daily limit of 20 clips, failed ones included", async () => {
    const { t, me, userId } = await setup();
    const fill = (n: number, status: string) =>
      t.run(async (ctx) => {
        for (let i = 0; i < n; i++) {
          await ctx.db.insert("studioClips", { userId, model: "kling-3", prompt: "p", aspect: "9:16", length: 5, status,
            seconds: 5, monthlySeconds: 0, extraSeconds: 0, startedAt: Date.now() - (i + 1) * 60_000 });
        }
      });
    await fill(10, "done");
    await fill(9, "failed");
    await expect(me.mutation(api.studio.start, clip)).resolves.toBeTruthy();
    await t.run(async (ctx) => {
      const last = await ctx.db.query("studioClips").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").first();
      await ctx.db.patch("studioClips", last!._id, { status: "failed" });
    });
    expect(await errorOf(me.mutation(api.studio.start, clip))).toEqual({ code: "LIMIT", message: "You've made 20 clips today. Try again tomorrow." });
  });

  it("isn't blocked by a day of UGC videos", async () => {
    const { t, me, userId, photoId } = await setup();
    await t.run(async (ctx) => {
      const adId = await ctx.db.insert("ads", {
        advertiserName: "a", platform: "Facebook", country: "US", niche: "n", headline: "h", bodyText: "", creativeUrl: "", landingPageUrl: "",
        spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
        firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
      });
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("remakes", { userId, adId, status: "failed", actorId: "maya", voiceId: "v", product: "p", productImageId: photoId,
          segments: [], seconds: 5, monthlySeconds: 0, extraSeconds: 0, startedAt: Date.now() - (i + 1) * 60_000 });
      }
    });
    await expect(me.mutation(api.studio.start, clip)).resolves.toBeTruthy();
  });

  it("is a Pro feature", async () => {
    const { me } = await setup({ plan: "free" });
    expect(await errorOf(me.mutation(api.studio.start, clip))).toEqual({ code: "LIMIT", message: "AI videos come with Pro." });
  });

  it("needs FAL_KEY", async () => {
    const { me } = await setup();
    vi.stubEnv("FAL_KEY", "");
    expect(await errorOf(me.mutation(api.studio.start, clip))).toEqual({ code: "NOT_CONFIGURED", message: "AI video isn't switched on yet (FAL_KEY)." });
  });

  it("refuses a bad request with the rule's words", async () => {
    const { me } = await setup();
    expect(await errorOf(me.mutation(api.studio.start, { ...clip, prompt: " " }))).toEqual({ code: "BAD_REQUEST", message: "Describe the video first." });
  });

  it("won't start while a UGC video is being made", async () => {
    const { t, me, userId, photoId } = await setup();
    await t.run(async (ctx) => {
      const adId = await ctx.db.insert("ads", {
        advertiserName: "a", platform: "Facebook", country: "US", niche: "n", headline: "h", bodyText: "", creativeUrl: "", landingPageUrl: "",
        spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
        firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
      });
      await ctx.db.insert("remakes", { userId, adId, status: "rendering", actorId: "maya", voiceId: "v", product: "p", productImageId: photoId,
        segments: [], seconds: 5, monthlySeconds: 5, extraSeconds: 0, startedAt: Date.now() });
    });
    expect(await errorOf(me.mutation(api.studio.start, clip))).toMatchObject({ code: "BUSY" });
  });
});

describe("studio.advance", () => {
  it("renders the clip from the prompt and stores it", async () => {
    const { t, me } = await setup();
    const posts = stubFal();
    const id = await me.mutation(api.studio.start, clip);
    await drive(t, id, 3);
    const row = await t.run((ctx) => ctx.db.get("studioClips", id));
    expect(row).toMatchObject({ status: "done" });
    expect(row?.videoId).toBeTruthy();
    expect(posts[0]).toMatchObject({ model: "fal-ai/kling-video/v3/pro/text-to-video", body: { prompt: clip.prompt, aspect_ratio: "9:16", duration: "5" } });
    expect(await me.query(api.studio.latest, {})).toMatchObject({ status: "done", model: "kling-3" });
    expect((await me.query(api.studio.latest, {}))?.videoUrl).toBeTruthy();
  });

  it("starts from the product photo when there is one", async () => {
    const { t, me, photoId } = await setup();
    const posts = stubFal();
    const id = await me.mutation(api.studio.start, { ...clip, imageId: photoId });
    await drive(t, id, 1);
    expect(posts[0].model).toBe("fal-ai/kling-video/v3/pro/image-to-video");
    expect(posts[0].body.start_image_url).toMatch(/^https?:\/\//);
  });

  it("fails free when fal refuses", async () => {
    const { t, me } = await setup();
    stubFal({ submitStatus: 422 });
    const id = await me.mutation(api.studio.start, clip);
    await drive(t, id, 1);
    expect(await t.run((ctx) => ctx.db.get("studioClips", id))).toMatchObject({ status: "failed" });
    expect(await me.query(api.remake.allowance, {})).toMatchObject({ used: 0 });
  });

  it("re-roll sends a new seed", async () => {
    const { t, me } = await setup();
    const posts = stubFal();
    const first = await me.mutation(api.studio.start, { ...clip, model: "seedance", seed: 1 });
    await drive(t, first, 3);
    const again = await me.mutation(api.studio.start, { ...clip, model: "seedance" });
    await drive(t, again, 1);
    expect(posts[0].body.seed).toBe(1);
    expect(typeof posts[1].body.seed).toBe("number");
    expect(posts[1].body.seed).not.toBe(1);
  });

  it("gives up after 20 minutes", async () => {
    const { t, me } = await setup();
    stubFal();
    const id = await me.mutation(api.studio.start, clip);
    await t.run((ctx) => ctx.db.patch("studioClips", id, { startedAt: Date.now() - 21 * 60_000 }));
    await drive(t, id, 1);
    expect(await t.run((ctx) => ctx.db.get("studioClips", id))).toMatchObject({
      status: "failed",
      error: "The video took too long. Try again; it didn't use your seconds.",
    });
  });
});

describe("studio.mine", () => {
  it("lists my finished videos from both tables, newest first", async () => {
    const { t, me, userId, photoId } = await setup();
    await t.run(async (ctx) => {
      const videoId = await ctx.storage.store(new Blob([new Uint8Array(10)], { type: "video/mp4" }));
      const adId = await ctx.db.insert("ads", {
        advertiserName: "a", platform: "Facebook", country: "US", niche: "n", headline: "Cooling mat", bodyText: "", creativeUrl: "", landingPageUrl: "",
        spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
        firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
      });
      const base = { status: "done", seconds: 5, monthlySeconds: 5, extraSeconds: 0, videoId };
      await ctx.db.insert("remakes", { ...base, userId, adId, actorId: "maya", voiceId: "v", product: "Cooling mat", productImageId: photoId, segments: [],
        startedAt: Date.now() - 120_000 });
      await ctx.db.insert("studioClips", { ...base, userId, model: "kling-3", prompt: "A dog", aspect: "9:16", length: 5, startedAt: Date.now() - 60_000 });
      await ctx.db.insert("studioClips", { ...base, userId, model: "kling-3", prompt: "Not done", aspect: "9:16", length: 5, status: "failed", startedAt: Date.now() });
      const other = await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      await ctx.db.insert("studioClips", { ...base, userId: other, model: "kling-3", prompt: "Theirs", aspect: "9:16", length: 5, startedAt: Date.now() });
    });
    const list = await me.query(api.studio.mine, {});
    expect(list.map((v) => [v.kind, v.title])).toEqual([["clip", "A dog"], ["ugc", "Cooling mat"]]);
    expect(list.every((v) => v.videoUrl)).toBe(true);
  });

  it("shows more than 60 videos when asked", async () => {
    const { t, me, userId } = await setup();
    await t.run(async (ctx) => {
      const videoId = await ctx.storage.store(new Blob([new Uint8Array(10)], { type: "video/mp4" }));
      for (let i = 0; i < 70; i++) {
        await ctx.db.insert("studioClips", { userId, model: "kling-3", prompt: `Clip ${i}`, aspect: "9:16", length: 5, status: "done", videoId,
          seconds: 5, monthlySeconds: 0, extraSeconds: 0, startedAt: Date.now() - i * 1000 });
      }
    });
    expect(await me.query(api.studio.mine, {})).toHaveLength(30);
    expect(await me.query(api.studio.mine, { limit: 90 })).toHaveLength(70);
  });

  it("lists the models with what they need", async () => {
    const { me } = await setup();
    const models = await me.query(api.studio.models, {});
    expect(models.map((m) => m.key)).toEqual(["kling-2.5", "kling-3", "seedance", "h3-turbo"]);
    expect(models[0]).toMatchObject({ multiplier: 0.5, lengths: [5, 10], needsPhoto: false, photoAspect: false });
  });
});
