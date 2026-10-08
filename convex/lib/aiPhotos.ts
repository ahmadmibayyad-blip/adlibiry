// AI product photos for a launch (convex/launchRun.ts): new scenes made from the
// product's real photo with Google's image model (Gemini "Nano Banana"), so a
// product whose only photos are plain supplier shots still gets a real store.
// GEMINI_API_KEY turns it on; GEMINI_IMAGE_MODEL picks another image model.

export const AI_PHOTO_COUNTS = [0, 2, 4, 6] as const;
export const MAX_AI_PHOTOS = 6;
export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

export const aiPhotosReady = () => !!process.env.GEMINI_API_KEY?.trim();
export const imageModel = () => process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;

// One scene per photo, in order: the most useful first.
const SCENES = [
  "being used in a real, everyday setting where people would use it, bright natural light (lifestyle photo)",
  "close-up that shows its material, texture and details, soft natural light, shallow depth of field",
  "on a clean, softly coloured studio background with a gentle shadow (premium online-store hero shot)",
  "held in a person's hands so its size is clear, natural light",
  "outdoors in daylight in a candid lifestyle moment",
  "styled flat lay from above on a neutral surface with a few fitting props",
];

export function photoPrompts(p: { title: string; category?: string; description?: string }, count: number): string[] {
  const about = [`Product: ${p.title.slice(0, 160)}`, p.category ? `Category: ${p.category}` : "", p.description ? `About it: ${p.description.slice(0, 300)}` : ""]
    .filter(Boolean)
    .join("\n");
  return SCENES.slice(0, Math.max(0, Math.min(MAX_AI_PHOTOS, Math.round(count)))).map((scene) =>
    [
      `Make a photorealistic, square product photo for an online store: the product in the attached photo, ${scene}.`,
      "Keep the product exactly as it is in the attached photo: the same shape, colours, materials, parts and proportions. Show it whole.",
      "No text, words, logos, watermarks, badges, prices or brand names anywhere in the image.",
      "If people appear, they are adults with natural, relaxed poses. Animals only if the product is for them.",
      about,
    ].join("\n"),
  );
}

export type InlineImage = { mimeType: string; data: string };

/**
 * The picture behind one ad of the launch's ad kit: portrait 4:5 (Facebook/Instagram feed), a scene that fits the
 * ad's angle, and a calm top third where the app writes the hook (the model never writes text: it misspells).
 */
export function adPhotoPrompt(p: { title: string; category?: string }, ad: { angle: string; hook: string }): string {
  return [
    "Make a scroll-stopping, photorealistic social media ad photo, portrait 4:5, of the product in the attached photo.",
    `The ad's angle: ${ad.angle.slice(0, 80)}. Its hook: "${ad.hook.slice(0, 160)}". Show a real-life scene that makes this angle obvious at a glance.`,
    "Keep the product exactly as it is in the attached photo: the same shape, colours, materials, parts and proportions. Keep it large and clearly visible in the lower two thirds.",
    "Keep the top third calm and uncluttered (a soft background, wall, sky or surface): a headline will be placed there.",
    "No text, words, logos, watermarks, badges, prices or brand names anywhere in the image.",
    "If people appear, they are adults with natural, relaxed poses. Animals only if the product is for them.",
    `Product: ${p.title.slice(0, 160)}${p.category ? ` (${p.category})` : ""}`,
  ].join("\n");
}

/** The generateContent request: the prompt plus the real photo, asking for one image back. */
export function geminiImageRequest(prompt: string, photo: InlineImage, aspectRatio = "1:1") {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: photo.mimeType, data: photo.data } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
  };
}

/** The image in a generateContent response, or why there's none. */
export function imageFromGemini(body: unknown): InlineImage | { error: string } {
  const b = body as {
    candidates?: { finishReason?: string; content?: { parts?: { inlineData?: Partial<InlineImage>; inline_data?: { mime_type?: string; data?: string } }[] } }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  } | null;
  if (b?.error?.message) return { error: b.error.message };
  if (b?.promptFeedback?.blockReason) return { error: `blocked (${b.promptFeedback.blockReason})` };
  for (const c of b?.candidates ?? []) {
    for (const part of c.content?.parts ?? []) {
      const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type;
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (data && mimeType?.startsWith("image/")) return { mimeType, data };
    }
  }
  return { error: `no image (${b?.candidates?.[0]?.finishReason ?? "empty response"})` };
}

/** The Shopify photo order: the first real photo, then the AI photos, then the other real photos. */
export function withAiPhotos(real: string[], ai: string[]): string[] {
  return [...real.slice(0, 1), ...ai, ...real.slice(1)];
}
