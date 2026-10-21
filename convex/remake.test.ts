/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
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
