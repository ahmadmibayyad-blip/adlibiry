import { describe, expect, it } from "vitest";
import { findVideoUrl } from "./videoUrl";

describe("findVideoUrl", () => {
  it("finds video links under video/play fields, at any depth", () => {
    expect(findVideoUrl({ video_url: "https://v.example.com/a.mp4" })).toBe("https://v.example.com/a.mp4");
    expect(findVideoUrl({ video_info: { play_addr: { url_list: ["https://v.example.com/b"] } } })).toBe("https://v.example.com/b");
    expect(findVideoUrl({ items: [{ playUrl: "https://v.example.com/c" }] })).toBe("https://v.example.com/c");
  });

  it("ignores covers, images and unrelated links", () => {
    expect(findVideoUrl({ video_cover: "https://img.example.com/a.jpg", web_url: "https://shop.example.com" })).toBeUndefined();
    expect(findVideoUrl({ video: { cover: { url: "https://img.example.com/a" }, poster: "https://x" } })).toBeUndefined();
    expect(findVideoUrl({ video_url: "https://img.example.com/a.jpg?x=1" })).toBeUndefined();
    expect(findVideoUrl({ video_id: "12345" })).toBeUndefined();
  });
});
