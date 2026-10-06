// Perceptual image hash (64-bit difference hash) for spotting the same product
// photo across sources: an Amazon listing and a Shopify ad landing page often
// use the same supplier image under a different URL and title.
// convex/imageHashAction.ts fetches and shrinks the images; the math is here.

// Images hashed per round of convex/imageHashAction.ts.
export const PRODUCTS_PER_ROUND = 100;
export const ADS_PER_ROUND = 100;

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;

/**
 * RGBA pixels (width x height) → 9x8 grayscale grid, each cell the average of
 * its block of pixels. Averaging (not sampling a few pixels) keeps the hash
 * stable when the same photo is resized or re-compressed.
 */
export function grayGrid(data: ArrayLike<number>, width: number, height: number): number[] {
  if (width < 1 || height < 1 || data.length < width * height * 4) throw new Error("bad image size");
  const gray: number[] = [];
  for (let gy = 0; gy < HASH_HEIGHT; gy++) {
    const y0 = Math.floor((gy * height) / HASH_HEIGHT);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / HASH_HEIGHT));
    for (let gx = 0; gx < HASH_WIDTH; gx++) {
      const x0 = Math.floor((gx * width) / HASH_WIDTH);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / HASH_WIDTH));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      gray.push(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return gray;
}

/** 9x8 grayscale (72 values) → difference hash as 16 hex chars: one bit per "left pixel brighter than right". */
export function dHashFromGray(gray: number[]): string {
  if (gray.length !== HASH_WIDTH * HASH_HEIGHT) throw new Error("dHash needs exactly 9x8=72 gray values");
  let bits = 0n;
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      const i = y * HASH_WIDTH + x;
      bits = (bits << 1n) | (gray[i] > gray[i + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function bitCount(hash: string): number {
  let x = BigInt(`0x${hash}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Can this hash identify a product? Blank, single-colour and plain-gradient
 * images (placeholders, logos on white) hash to almost all 0s or 1s, and
 * unrelated products with such images would be merged. Empty = couldn't hash.
 */
export function isUsableHash(hash: string | undefined): hash is string {
  if (!hash || !/^[0-9a-f]{16}$/.test(hash)) return false;
  const ones = bitCount(hash);
  return ones >= 8 && ones <= 56;
}

/** Number of differing bits between two hashes. */
export function hamming(a: string, b: string): number {
  return bitCount((BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(16));
}

// The same photo resized or re-compressed comes out a few bits different, so
// "same image" means at most this many differing bits. Unrelated images
// differ in about 32.
export const SAME_IMAGE_MAX_DISTANCE = 4;

export function isSameImage(a: string | undefined, b: string | undefined): boolean {
  return isUsableHash(a) && isUsableHash(b) && hamming(a, b) <= SAME_IMAGE_MAX_DISTANCE;
}

/**
 * The hash in four 16-bit parts, each indexed on products. Two hashes at most
 * 3 bits apart always share at least one part, so looking up each part finds
 * near matches without scanning every product.
 */
export function hashBands(hash: string): [string, string, string, string] {
  return [hash.slice(0, 4), hash.slice(4, 8), hash.slice(8, 12), hash.slice(12, 16)];
}

/** Product fields for a hash of `url` ("" = couldn't read; parts only for usable hashes). */
export function productHashFields(hash: string, url: string) {
  const bands = isUsableHash(hash) ? hashBands(hash) : [undefined, undefined, undefined, undefined];
  return { imageHash: hash, imageHashUrl: url, hashBand0: bands[0], hashBand1: bands[1], hashBand2: bands[2], hashBand3: bands[3] };
}
