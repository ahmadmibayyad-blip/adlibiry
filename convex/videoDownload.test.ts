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

  it("downloads TikTok ads through TikTok's video page", async () => {
    process.env.CONVEX_SITE_URL = "https://site.example";
    const t = convexTest(schema, modules);
    const adId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("ads", { ...adBase, externalKey: "tiktok_7412345678901234567" });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { video: { playAddr: "https://v16.tiktokcdn.com/x.mp4" } } } } },
    })}</script>`;
    const calls: { url: string; cookie: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), cookie: new Headers(init?.headers).get("cookie") });
      if (String(url).includes("www.tiktok.com")) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html", "set-cookie": "tt_chain_token=abc; Path=/" } });
      }
      return new Response("TT", { status: 200, headers: { "content-type": "video/mp4", "content-length": "2" } });
    });
    const link = await me.action(api.videoDownload.downloadUrl, { adId });
    const res = await t.fetch(link.replace("https://site.example", ""));
    expect(await res.text()).toBe("TT");
    expect(calls.map((c) => c.url)).toEqual(["https://www.tiktok.com/@_/video/7412345678901234567", "https://v16.tiktokcdn.com/x.mp4"]);
    expect(calls[1].cookie).toBe("tt_chain_token=abc");

    vi.stubGlobal("fetch", async () => new Response("<html>captcha</html>", { status: 200 }));
    await expect(me.action(api.videoDownload.downloadUrl, { adId })).rejects.toThrow(/TikTok didn't give us the file/);
  });
});
