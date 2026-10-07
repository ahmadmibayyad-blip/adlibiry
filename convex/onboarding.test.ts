/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("onboarding and the morning digest", () => {
  it("saves niches and timezone, filters the digest by niche, and unsubscribes with the link's token", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const sent: { to: string; html: string; headers?: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", email: "u1@x.com", role: "user" });
      const product = { description: "", imageUrl: "", tags: [], saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z" };
      const pet = await ctx.db.insert("products", { ...product, title: "Dog cooling mat", category: "Pet Supplies", aiScore: 90 });
      const beauty = await ctx.db.insert("products", { ...product, title: "Lip oil", category: "Beauty", aiScore: 95 });
      await ctx.db.insert("winningProducts", { productId: pet, niche: "Pet Supplies", nicheRank: 1, position: 1, score: 90, enteredDay: "2026-10-07" });
      await ctx.db.insert("winningProducts", { productId: beauty, niche: "Beauty", nicheRank: 1, position: 0, score: 95, enteredDay: "2026-10-07" });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.query(api.onboarding.mine, {})).toMatchObject({ onboarded: false, niches: [] });
    await me.mutation(api.onboarding.complete, { niches: ["Pet Supplies"], timezone: "Europe/Copenhagen", digest: true });
    expect(await me.query(api.onboarding.mine, {})).toMatchObject({ onboarded: true, niches: ["Pet Supplies"], digest: true, timezone: "Europe/Copenhagen" });

    // 05:10 UTC = 07:10 in Copenhagen: not yet. 06:10 UTC = 08:10: sent, once.
    expect(await t.action(internal.emailSender.sendMorningDigests, { nowMs: Date.parse("2026-10-07T05:10:00Z") })).toEqual({ sent: 0, skipped: 0 });
    expect(await t.action(internal.emailSender.sendMorningDigests, { nowMs: Date.parse("2026-10-07T06:10:00Z") })).toEqual({ sent: 1, skipped: 0 });
    expect(await t.action(internal.emailSender.sendMorningDigests, { nowMs: Date.parse("2026-10-07T07:10:00Z") })).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("Dog cooling mat");
    expect(sent[0].html).not.toContain("Lip oil"); // not in their niches
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const token = sent[0].html.match(/unsubscribe\?token=([0-9a-f-]{36})/)![1];
    expect(await t.mutation(api.digest.unsubscribe, { token })).toEqual({ ok: true });
    expect(await me.query(api.onboarding.mine, {})).toMatchObject({ digest: false });
    expect(await t.mutation(api.digest.unsubscribe, { token: "not-a-token" })).toEqual({ ok: false });
  });
});
