import { describe, expect, it } from "vitest";
import { acceptableMedia, dailyCap, mediaToHost } from "./adMedia";

describe("mediaToHost", () => {
  const ad = { creativeUrl: "https://scontent.example/a.jpg", videoUrl: "https://video.example/a.mp4" };

  it("copies images of any ad and videos of saved ones", () => {
    expect(mediaToHost(ad, false)).toEqual({ image: true, video: false });
    expect(mediaToHost(ad, true)).toEqual({ image: true, video: true });
  });

  it("skips what's copied, failed, or not a web link", () => {
    expect(mediaToHost({ ...ad, hostedImageId: "x", hostedVideoId: "y" }, true)).toEqual({ image: false, video: false });
    expect(mediaToHost({ ...ad, mediaStatus: "failed", videoStatus: "failed" }, true)).toEqual({ image: false, video: false });
    expect(mediaToHost({ creativeUrl: "", videoUrl: "data:video/mp4;base64,AA" }, true)).toEqual({ image: false, video: false });
  });
});

describe("acceptableMedia", () => {
  it("wants the right kind and size", () => {
    expect(acceptableMedia("image", "image/jpeg", 2000)).toBe(true);
    expect(acceptableMedia("image", "text/html", 2000)).toBe(false);
    expect(acceptableMedia("image", "image/png", 6_000_000)).toBe(false);
    expect(acceptableMedia("video", "video/mp4", 30_000_000)).toBe(true);
    expect(acceptableMedia("video", "video/mp4", 0)).toBe(false);
  });
});

describe("dailyCap", () => {
  it("reads a positive number or falls back", () => {
    expect(dailyCap("500", 2000)).toBe(500);
    expect(dailyCap("", 2000)).toBe(2000);
    expect(dailyCap("-3", 2000)).toBe(2000);
  });
});
