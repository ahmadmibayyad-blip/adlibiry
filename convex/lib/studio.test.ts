import { describe, expect, it } from "vitest";
import { STUDIO_MODELS, chargeFor, falInput, validateRequest, type StudioModelKey } from "./studio";

const model = (key: StudioModelKey) => STUDIO_MODELS.find((m) => m.key === key)!;
const ok = { model: "seedance", prompt: "  A dog on a mat  ", aspect: "9:16", length: 5, hasPhoto: false };

describe("studio rules", () => {
  it("charges length × multiplier, rounded up, at least 1", () => {
    expect(chargeFor(model("kling-2.5"), 5)).toBe(3);
    expect(chargeFor(model("kling-3"), 10)).toBe(10);
    expect(chargeFor({ ...model("h3-turbo"), multiplier: 0.1 }, 2)).toBe(1);
  });

  it("validates the request with the user's words", () => {
    expect(validateRequest(ok)).toMatchObject({ prompt: "A dog on a mat", aspect: "9:16", length: 5 });
    expect(() => validateRequest({ ...ok, prompt: " " })).toThrow("Describe the video first.");
    expect(() => validateRequest({ ...ok, prompt: "x".repeat(1501) })).toThrow("Describe the video first.");
    expect(() => validateRequest({ ...ok, model: "veo" })).toThrow("Pick a model from the list.");
    expect(() => validateRequest({ ...ok, length: 13 })).toThrow("Pick a length this model makes.");
    expect(() => validateRequest({ ...ok, aspect: "4:5" })).toThrow("Pick a format this model makes.");
  });

  it("lets a photo set the format for models that follow it", () => {
    expect(validateRequest({ ...ok, model: "h3-turbo", aspect: "9:16", hasPhoto: true })).toMatchObject({ aspect: "9:16" });
    expect(() => validateRequest({ ...ok, model: "h3-turbo", aspect: "9:16" })).toThrow("Pick a format this model makes.");
  });

  it("needs a photo for a model without text-to-video", () => {
    const noText = { ...model("kling-2.5"), key: "kling-2.5" as const, textEndpoint: null };
    expect(() => validateRequest(ok, [noText].map((m) => ({ ...m, key: "seedance" as const })))).toThrow("Add a product photo for this model.");
  });

  it("builds each model's fal body", () => {
    for (const m of STUDIO_MODELS) {
      const r = { prompt: "p", aspect: m.aspects[0], length: m.lengths[0] };
      const withPhoto = falInput(m, r, "https://img", 7);
      expect(withPhoto.endpoint).toBe(m.imageEndpoint);
      expect(withPhoto.body).toMatchObject({ prompt: "p", [m.imageParam]: "https://img" });
      expect(withPhoto.body.seed).toBe(m.seeded ? 7 : undefined);
      if (m.textEndpoint) {
        const text = falInput(m, r, null, null);
        expect(text.endpoint).toBe(m.textEndpoint);
        expect(text.body).not.toHaveProperty(m.imageParam);
      }
    }
    expect(falInput(model("seedance"), { prompt: "p", aspect: "1:1", length: 5 }, null, null).body).toMatchObject({
      duration: "5", aspect_ratio: "1:1", resolution: "1080p",
    });
    expect(falInput(model("kling-2.5"), { prompt: "p", aspect: "9:16", length: 10 }, "https://img", null).body).not.toHaveProperty("aspect_ratio");
    expect(falInput(model("kling-3"), { prompt: "p", aspect: "9:16", length: 5 }, "https://img", null).body).toMatchObject({ generate_audio: false });
    expect(falInput(model("h3-turbo"), { prompt: "p", aspect: "16:9", length: 5 }, null, 3).body).toMatchObject({ duration: 5, resolution: "1080P", seed: 3 });
  });
});
