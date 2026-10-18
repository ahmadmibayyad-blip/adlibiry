import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { byTier } from "./lib/billing";
import {
  ELEVEN_FORMAT, ELEVEN_MODEL, ELEVEN_URL, KEPT_PER_USER, MAX_VOICE_CHARS, VOICEOVER_RUNS, describeElevenError, readVoices, type VoiceOption,
} from "./lib/voiceover";

// ── AI voiceover ────────────────────────────────────────────────────────────
// Ad page → video analysis → "Write my version" → Voiceover: ElevenLabs reads
// the script's voice-over lines (lib/voiceover.ts). The MP3 goes to file
// storage and its link back to the page; each user keeps their newest
// KEPT_PER_USER. Per-user daily VOICEOVER_RUNS. Needs ELEVENLABS_API_KEY.

const DAY_MS = 24 * 60 * 60 * 1000;

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  if (!k) throw new ConvexError({ code: "NOT_SET_UP", message: "Voiceovers aren't switched on yet (ELEVENLABS_API_KEY)." });
  return k;
}

/** The voices to pick from: ElevenLabs' premade ones plus any in the account. */
export const voices = action({
  args: {},
  handler: async (ctx): Promise<VoiceOption[]> => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const res = await fetch(`${ELEVEN_URL}/voices`, { headers: { "xi-api-key": key() }, signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ConvexError({ code: "VOICE_ERROR", message: describeElevenError(res.status, body, false) });
    return readVoices(body);
  },
});

export const claim = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const limit = byTier(user, VOICEOVER_RUNS);
    const used = (await ctx.db.query("voiceovers").withIndex("by_user", (q) => q.eq("userId", user._id).gt("at", Date.now() - DAY_MS)).take(limit)).length;
    return { userId: user._id, admin: user.role === "admin", limit, used };
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), storageId: v.id("_storage"), voiceId: v.string(), chars: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("voiceovers", { ...args, at: Date.now() });
    const old = (await ctx.db.query("voiceovers").withIndex("by_user", (q) => q.eq("userId", args.userId)).order("desc").take(KEPT_PER_USER + 10)).slice(
      KEPT_PER_USER,
    );
    for (const o of old) {
      await ctx.storage.delete(o.storageId);
      await ctx.db.delete("voiceovers", o._id);
    }
  },
});

/** Reads the text with the voice; returns the MP3's link and what's left today. */
export const make = action({
  args: { text: v.string(), voiceId: v.string() },
  handler: async (ctx, args): Promise<{ url: string; left: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const text = args.text.trim();
    if (!text) throw new ConvexError({ code: "BAD_REQUEST", message: "There's no voice-over text in this script." });
    if (text.length > MAX_VOICE_CHARS) throw new ConvexError({ code: "BAD_REQUEST", message: `Keep the voice-over under ${MAX_VOICE_CHARS} characters.` });
    if (!/^[A-Za-z0-9]{8,40}$/.test(args.voiceId)) throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a voice from the list." });
    const apiKey = key();
    const c = await ctx.runQuery(internal.voiceover.claim, { token: stableToken(identity) });
    if (!c) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (c.used >= c.limit) {
      throw new ConvexError({
        code: "LIMIT",
        message:
          c.limit <= VOICEOVER_RUNS.trial
            ? `You've made ${c.limit} voiceover${c.limit === 1 ? "" : "s"} today. Upgrade to Pro for ${VOICEOVER_RUNS.paid} a day.`
            : `You've made ${c.limit} voiceovers today. Try again tomorrow.`,
      });
    }
    const res = await fetch(`${ELEVEN_URL}/text-to-speech/${args.voiceId}?output_format=${ELEVEN_FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) {
      const body = await res.json().catch(() => null);
      console.warn("Voiceover: ElevenLabs", res.status, JSON.stringify(body).slice(0, 200));
      throw new ConvexError({ code: "VOICE_ERROR", message: describeElevenError(res.status, body, c.admin) });
    }
    const storageId: Id<"_storage"> = await ctx.storage.store(new Blob([await res.arrayBuffer()], { type: "audio/mpeg" }));
    await ctx.runMutation(internal.voiceover.save, { userId: c.userId, storageId, voiceId: args.voiceId, chars: text.length });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new ConvexError({ code: "VOICE_ERROR", message: "The voiceover failed. Try again." });
    return { url, left: Math.max(0, c.limit - c.used - 1) };
  },
});
