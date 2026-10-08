// The network side of AI photos (lib/aiPhotos.ts): download a real photo and
// ask Google's image model for a new one. Used by "use node" actions only
// (launchRun.ts, launchAds.ts), so Buffer is there.

import { geminiImageRequest, imageFromGemini, imageModel, type InlineImage } from "./aiPhotos";

/** Downloads a photo for the image model: jpeg, png or webp, at most 7 MB. */
export async function downloadPhoto(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "image/jpeg,image/png,image/webp,image/*" } });
    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 7_000_000) return null;
    return { mimeType, data: bytes.toString("base64") };
  } catch {
    return null;
  }
}

/** The first of `urls` (at most 4 tried) that downloads as a photo. */
export async function firstPhoto(urls: string[]): Promise<InlineImage | null> {
  for (const url of urls.slice(0, 4)) {
    const photo = await downloadPhoto(url);
    if (photo) return photo;
  }
  return null;
}

/** One image from the model, as bytes ready for Convex storage, or why there's none. */
export async function generateImage(key: string, prompt: string, photo: InlineImage, aspectRatio = "1:1"): Promise<Blob | { error: string }> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(imageModel())}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(geminiImageRequest(prompt, photo, aspectRatio)),
      signal: AbortSignal.timeout(120_000),
    });
    const image = imageFromGemini(await res.json().catch(() => null));
    if ("error" in image) return { error: `${res.status}: ${image.error}` };
    return new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
