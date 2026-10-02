/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const adBase = {
  advertiserName: "Paw Co", platform: "TikTok", country: "US", niche: "Pet Supplies", headline: "h", bodyText: "", creativeUrl: "",
  landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50,
  targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("video download", () => {
  it("gives signed-in users a short-lived download link", async () => {
    process.env.CONVEX_SITE_URL = "https://site.example";
    const t = convexTest(schema, modules);
    const [withVideo, noVideo] = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return [
        await ctx.db.insert("ads", { ...adBase, videoUrl: "https://cdn.example.com/v.mp4" }),
        await ctx.db.insert("ads", { ...adBase }),
      ];
    });
    await expect(t.action(api.videoDownload.downloadUrl, { adId: withVideo })).rejects.toThrow(/sign in/);
    const me = t.withIdentity({ subject: "u1|s" });
    await expect(me.action(api.videoDownload.downloadUrl, { adId: noVideo })).rejects.toThrow(/no video/);

    const link = await me.action(api.videoDownload.downloadUrl, { adId: withVideo });
    expect(link).toMatch(/^https:\/\/site\.example\/download\/video\?t=[a-f0-9]{32}$/);
    const path = link.replace("https://site.example", "");

    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(String(url));
      return new Response("VIDEO", { status: 200, headers: { "content-type": "video/mp4", "content-length": "5" } });
    });
    const res = await t.fetch(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="paw-co-ad.mp4"');
    expect(await res.text()).toBe("VIDEO");
    expect(fetched).toEqual(["https://cdn.example.com/v.mp4"]);

    expect((await t.fetch("/download/video?t=" + "0".repeat(32))).status).toBe(410);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await t.fetch(path)).status).toBe(410);
  });
});
