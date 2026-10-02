import { describe, expect, it } from "vitest";
import { isPlayable, tiktokEmbedUrl, tiktokVideoId } from "./adVideo.ts";

const base = { platform: "TikTok", landingPageUrl: "" };

describe("ad video", () => {
  it("finds the TikTok video id from the import key or a TikTok link", () => {
    expect(tiktokVideoId({ ...base, externalKey: "tiktok_7412345678901234567" })).toBe("7412345678901234567");
    expect(tiktokVideoId({ ...base, adLibraryUrl: "https://www.tiktok.com/@brand/video/7412345678901234567?lang=en" })).toBe("7412345678901234567");
    expect(tiktokVideoId({ ...base, externalKey: "tiktok_abc" })).toBeNull();
    expect(tiktokVideoId({ ...base, platform: "Facebook", externalKey: "tiktok_7412345678901234567" })).toBeNull();
  });

  it("knows when an ad can play", () => {
    expect(isPlayable({ ...base, videoUrl: "https://v/a.mp4" })).toBe(true);
    expect(isPlayable({ ...base, externalKey: "tiktok_7412345678901234567" })).toBe(true);
    expect(isPlayable({ ...base })).toBe(false);
    expect(tiktokEmbedUrl("1")).toBe("https://www.tiktok.com/player/v1/1?music_info=0&description=0&rel=0");
  });
});
