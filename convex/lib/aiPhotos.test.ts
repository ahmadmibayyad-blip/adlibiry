import { describe, expect, it } from "vitest";
import { geminiImageRequest, imageFromGemini, photoPrompts, withAiPhotos } from "./aiPhotos";

describe("AI product photos", () => {
  it("writes one scene per photo that keeps the product as it is", () => {
    const prompts = photoPrompts({ title: "SnuffleMaster snuffle mat", category: "Pet Supplies", description: "Hide treats in the mat" }, 4);
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts).size).toBe(4);
    for (const p of prompts) {
      expect(p).toContain("Product: SnuffleMaster snuffle mat");
      expect(p).toContain("Keep the product exactly as it is");
      expect(p).toContain("No text, words, logos");
    }
    expect(photoPrompts({ title: "x" }, 50)).toHaveLength(6);
    expect(photoPrompts({ title: "x" }, -1)).toHaveLength(0);
  });

  it("sends the photo with the prompt and reads the image back", () => {
    const req = geminiImageRequest("a scene", { mimeType: "image/jpeg", data: "AAA=" });
    expect(req.contents[0].parts).toEqual([{ text: "a scene" }, { inlineData: { mimeType: "image/jpeg", data: "AAA=" } }]);
    expect(req.generationConfig.responseModalities).toEqual(["IMAGE"]);

    expect(imageFromGemini({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: "iVBO" } }] } }] }))
      .toEqual({ mimeType: "image/png", data: "iVBO" });
    expect(imageFromGemini({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: "iVBO" } }] } }] }))
      .toEqual({ mimeType: "image/png", data: "iVBO" });
    expect(imageFromGemini({ error: { message: "API key not valid" } })).toEqual({ error: "API key not valid" });
    expect(imageFromGemini({ promptFeedback: { blockReason: "SAFETY" } })).toEqual({ error: "blocked (SAFETY)" });
    expect(imageFromGemini({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] })).toEqual({ error: "no image (IMAGE_SAFETY)" });
    expect(imageFromGemini(null)).toEqual({ error: "no image (empty response)" });
  });

  it("puts the AI photos after the first real photo", () => {
    expect(withAiPhotos(["r1", "r2"], ["a1", "a2"])).toEqual(["r1", "a1", "a2", "r2"]);
    expect(withAiPhotos([], ["a1"])).toEqual(["a1"]);
  });
});
