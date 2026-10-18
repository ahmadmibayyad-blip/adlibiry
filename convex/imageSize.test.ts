/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { imageSize } from "./lib/imageSize";

describe("imageSize", () => {
  it("reads PNG and JPEG sizes without decoding", async () => {
    const img = new Jimp({ width: 321, height: 123, color: 0x3366ccff });
    expect(imageSize(await img.getBuffer("image/png"))).toEqual({ width: 321, height: 123 });
    expect(imageSize(await img.getBuffer("image/jpeg"))).toEqual({ width: 321, height: 123 });
  });

  it("reads GIF and WebP headers", () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 });
    // VP8X: canvas width-1 and height-1 as 24-bit little endian at 24 and 27.
    const webp = new Uint8Array(30);
    webp.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    webp.set([0x3f, 0x1f, 0x00, 0xcf, 0x0f, 0x00], 24); // 8000 × 4048
    expect(imageSize(webp)).toEqual({ width: 8000, height: 4048 });
  });

  it("returns null for other files and cut-off headers", () => {
    expect(imageSize(new TextEncoder().encode("<html>not an image</html>"))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
