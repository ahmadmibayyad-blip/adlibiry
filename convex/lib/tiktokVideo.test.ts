import { describe, expect, it } from "vitest";
import { cookieHeader, videoFileFromPage } from "./tiktokVideo";

const page = (video: object) =>
  `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { video } } } },
  })}</script></html>`;

describe("tiktok video page", () => {
  it("finds the video file link", () => {
    expect(videoFileFromPage(page({ playAddr: "https://v16.tiktokcdn.com/play.mp4", downloadAddr: "https://v16.tiktokcdn.com/dl.mp4" }))).toBe(
      "https://v16.tiktokcdn.com/dl.mp4",
    );
    expect(videoFileFromPage(page({ downloadAddr: "", playAddr: "https://v16.tiktokcdn.com/play.mp4" }))).toBe("https://v16.tiktokcdn.com/play.mp4");
    expect(videoFileFromPage(page({ bitrateInfo: [{ PlayAddr: { UrlList: ["https://v19.tiktokcdn.com/b.mp4"] } }] }))).toBe(
      "https://v19.tiktokcdn.com/b.mp4",
    );
  });

  it("returns null for pages without a video", () => {
    expect(videoFileFromPage("<html>captcha</html>")).toBeNull();
    expect(videoFileFromPage(page({}))).toBeNull();
  });

  it("turns Set-Cookie into a Cookie header", () => {
    expect(cookieHeader("tt_chain_token=abc; Path=/; Expires=Wed, 01 Oct 2026 10:00:00 GMT, ttwid=x%7Cy; Domain=.tiktok.com")).toBe(
      "tt_chain_token=abc; ttwid=x%7Cy",
    );
    expect(cookieHeader(null)).toBe("");
  });
});
