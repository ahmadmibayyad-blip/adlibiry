// Screenshots for the AI (convex/lib/screenshots.ts): shrunk to a readable width and, when the page is long,
// cut into parts top to bottom, so text stays legible instead of one tiny strip. Sent as JPEG base64.

import type { ClipboardEvent as ReactClipboardEvent } from "react";

export type ScreenshotPart = { data: string; mediaType: string };

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image. Use a JPG, PNG or WebP screenshot."));
    img.src = url;
  });

export async function screenshotParts(
  file: Blob,
  { maxWidth = 1280, partHeight = 1600, maxParts = 6 }: { maxWidth?: number; partHeight?: number; maxParts?: number } = {},
): Promise<{ parts: ScreenshotPart[]; preview: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (JPG, PNG or WebP).");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Narrow enough to read, and short enough to fit in the parts allowed.
    const scale = Math.min(1, maxWidth / img.width, (partHeight * maxParts) / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const count = Math.max(1, Math.ceil(height / partHeight));
    const parts: ScreenshotPart[] = [];
    let preview = "";
    for (let i = 0; i < count; i++) {
      const top = i * partHeight;
      const h = Math.min(partHeight, height - top);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = h;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("Your browser couldn't read that image.");
      g.fillStyle = "#ffffff"; // transparent PNGs: white, not black, behind them
      g.fillRect(0, 0, width, h);
      g.drawImage(img, 0, -top, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (i === 0) preview = dataUrl;
      parts.push({ data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    }
    return { parts, preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The first image in a paste event (a screenshot copied to the clipboard), if any. */
export function pastedImage(e: ClipboardEvent | ReactClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
