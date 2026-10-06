import { describe, expect, it } from "vitest";
import { dHashFromGray, grayGrid, hamming, hashBands, isSameImage, isUsableHash } from "./imageHash";

// A width x height RGBA "photo": blocky pattern of light and dark patches.
function photo(width: number, height: number, seed: number, noise = 0): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = Math.floor((x * 9) / width) * 7 + Math.floor((y * 8) / height) * 3;
      const v = ((cell * seed) % 9) * 28 + ((x + y) % 2 ? noise : -noise);
      const i = (y * width + x) * 4;
      data.set([v, v, v, 255].map((c) => Math.max(0, Math.min(255, c))), i);
    }
  }
  return data;
}
const hashOf = (data: Uint8Array, w: number, h: number) => dHashFromGray(grayGrid(data, w, h));

describe("image hash", () => {
  it("is 16 hex chars and the same for a resized or slightly re-compressed copy", () => {
    const h = hashOf(photo(90, 80, 5), 90, 80);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashOf(photo(450, 400, 5), 450, 400)).toBe(h);
    expect(hashOf(photo(450, 400, 5, 3), 450, 400)).toBe(h);
    expect(isUsableHash(h)).toBe(true);
  });

  it("differs for a different image", () => {
    expect(hashOf(photo(90, 80, 5), 90, 80)).not.toBe(hashOf(photo(90, 80, 4), 90, 80));
  });

  it("won't use blank or plain images, or ones that couldn't be read", () => {
    const blank = new Uint8Array(90 * 80 * 4).fill(255);
    expect(isUsableHash(hashOf(blank, 90, 80))).toBe(false);
    expect(isUsableHash("")).toBe(false);
    expect(isUsableHash(undefined)).toBe(false);
    expect(isUsableHash("ffffffffffffffff")).toBe(false);
  });
});

describe("near matches", () => {
  it("counts differing bits and treats a few as the same image", () => {
    expect(hamming("a5f0c3e1b2d49687", "a5f0c3e1b2d49687")).toBe(0);
    expect(hamming("a5f0c3e1b2d49687", "a5f0c3e1b2d49680")).toBe(3);
    expect(isSameImage("a5f0c3e1b2d49687", "a5f0c3e1b2d49680")).toBe(true);
    expect(isSameImage("a5f0c3e1b2d49687", "5a0f3c1e2b4d6978")).toBe(false);
    expect(isSameImage("0000000000000000", "0000000000000000")).toBe(false); // blank images never match
  });

  it("hashes up to 3 bits apart always share an indexed part", () => {
    const a = "a5f0c3e1b2d49687";
    for (const flips of [[0, 20, 40], [1, 2, 3], [15, 31, 63]]) {
      let x = BigInt(`0x${a}`);
      for (const bit of flips) x ^= 1n << BigInt(bit);
      const b = x.toString(16).padStart(16, "0");
      expect(hashBands(a).some((part, i) => part === hashBands(b)[i])).toBe(true);
    }
  });
});

