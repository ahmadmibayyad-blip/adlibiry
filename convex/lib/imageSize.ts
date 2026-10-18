// An image's width and height from its first bytes, without decoding it, so a
// file that is small on disk but huge in pixels (an 8000 × 8000 PNG is 256 MB
// once decoded) can be skipped before it uses up an action's memory.
// JPEG, PNG, GIF and WebP; null for anything else or a cut-off header.

export type Size = { width: number; height: number };

export function imageSize(b: Uint8Array): Size | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  const ok = (s: Size) => (s.width > 0 && s.height > 0 ? s : null);

  // PNG: signature, then the IHDR chunk.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return ok({ width: u32be(16), height: u32be(20) });
  // GIF: logical screen size.
  if (b.length >= 10 && ascii(0, 3) === "GIF") return ok({ width: u16le(6), height: u16le(8) });
  // WebP: RIFF container with a VP8, VP8L or VP8X chunk.
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return ok({ width: u24le(24) + 1, height: u24le(27) + 1 });
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok({ width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 });
    }
    if (chunk === "VP8 ") return ok({ width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff });
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = u16be(i + 2);
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok({ width: u16be(i + 7), height: u16be(i + 5) });
      }
      i += 2 + len;
    }
  }
  return null;
}
