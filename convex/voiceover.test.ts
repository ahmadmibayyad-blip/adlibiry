/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { KEPT_PER_USER, VOICEOVER_RUNS, describeElevenError, readVoices, voiceText } from "./lib/voiceover";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("voiceover helpers", () => {
  it("reads only the spoken lines", () => {
    expect(voiceText([{ voiceover: "Er din hund varm?" }, { voiceover: "  " }, { voiceover: "Bestil i dag." }])).toBe("Er din hund varm?\nBestil i dag.");
  });

  it("lists premade voices first", () => {
    const list = readVoices({
      voices: [
        { voice_id: "own1", name: "My clone", category: "cloned", labels: {} },
        { voice_id: "abc123XYZ", name: "Sarah", category: "premade", labels: { gender: "female", accent: "american" }, preview_url: "https://x/p.mp3" },
        { name: "broken" },
      ],
    });
    expect(list).toEqual([
      { id: "abc123XYZ", name: "Sarah", gender: "female", accent: "american", preview: "https://x/p.mp3" },
      { id: "own1", name: "My clone", gender: undefined, accent: undefined, preview: undefined },
    ]);
  });

  it("explains ElevenLabs errors", () => {
    expect(describeElevenError(401, {}, false)).toMatch(/ELEVENLABS_API_KEY/);
    expect(describeElevenError(400, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }, true)).toMatch(
      /out of credits.*ElevenLabs: This request exceeds/,
    );
  });
});

describe("voiceover.make", () => {
  async function setup(plan: "pro" | "none" = "pro") {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan, subscriptionStatus: plan === "pro" ? "active" : undefined }));
    return { t, me: t.withIdentity({ subject: "u1|s" }) };
  }

  it("records the text with the chosen voice and keeps the MP3", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "el_test");
    const calls: { url: string; body: { text: string; model_id: string }; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("xi-api-key") });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    const { t, me } = await setup();
    const r = await me.action(api.voiceover.make, { text: "Er din hund varm?", voiceId: "abc123XYZ" });
    expect(r.left).toBe(VOICEOVER_RUNS.paid - 1);
    expect(r.url).toMatch(/^https?:\/\//);
    expect(calls[0]).toMatchObject({ body: { text: "Er din hund varm?", model_id: "eleven_multilingual_v2" }, key: "el_test" });
    expect(calls[0].url).toContain("/text-to-speech/abc123XYZ?output_format=mp3_44100_128");
    expect(await t.run((ctx) => ctx.db.query("voiceovers").collect())).toHaveLength(1);
  });

  it("keeps only the newest MP3s per user", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "el_test");
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }));
    const admin = t.withIdentity({ subject: "a1|s" });
    for (let i = 0; i < KEPT_PER_USER + 2; i++) await admin.action(api.voiceover.make, { text: `Line ${i}`, voiceId: "abc123XYZ" });
    expect(await t.run((ctx) => ctx.db.query("voiceovers").collect())).toHaveLength(KEPT_PER_USER);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(KEPT_PER_USER);
  });

  it("stops at the free daily limit, and says when it isn't set up", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "el_test");
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const { me } = await setup("none");
    await me.action(api.voiceover.make, { text: "Hej", voiceId: "abc123XYZ" });
    await expect(me.action(api.voiceover.make, { text: "Hej igen", voiceId: "abc123XYZ" })).rejects.toThrow(/Upgrade to Pro/);
    await expect(me.action(api.voiceover.make, { text: "x", voiceId: "../../etc" })).rejects.toThrow(/Pick a voice/);
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    await expect(me.action(api.voiceover.make, { text: "x", voiceId: "abc123XYZ" })).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });

  it("offers the standard voices when the key can't read the voice list", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "el_tts_only");
    vi.stubGlobal("fetch", async () =>
      Response.json({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission voices_read" } }, { status: 401 }),
    );
    const { me } = await setup();
    const list = await me.action(api.voiceover.voices, {});
    expect(list.length).toBeGreaterThan(4);
    expect(list[0]).toMatchObject({ name: "Sarah" });
    expect(describeElevenError(401, { detail: { status: "missing_permissions", message: "missing the permission text_to_speech" } }, false)).toMatch(
      /Text to Speech/,
    );
  });

  it("turns an ElevenLabs refusal into a plain message", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "el_bad");
    vi.stubGlobal("fetch", async () => Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 }));
    const { me } = await setup();
    await expect(me.action(api.voiceover.make, { text: "Hej", voiceId: "abc123XYZ" })).rejects.toThrow(/refused the key/);
  });
});
