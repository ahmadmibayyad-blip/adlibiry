// AI Studio → Playground (convex/studio.ts): a prompt and an optional product photo become a clip from one of the
// fal models below. A clip uses the user's AI-video seconds like a remake: its length × the model's multiplier
// (fal's price per second against OmniHuman's $0.16/s, rounded up to the next 0.5). Checked on fal 2026-10-21.
// Pure parts, tested in studio.test.ts.

export type StudioModelKey = "kling-2.5" | "kling-3" | "seedance" | "h3-turbo";
export type Aspect = "9:16" | "1:1" | "16:9";

export type StudioModel = {
  key: StudioModelKey;
  name: string;
  blurb: string;
  imageEndpoint: string;
  textEndpoint: string | null; // null = needs a photo
  imageParam: "image_url" | "start_image_url";
  lengths: number[];
  aspects: Aspect[]; // formats without a photo
  photoAspect: boolean; // the format applies with a photo too; else the clip follows the photo
  multiplier: number;
  seeded: boolean;
};

export const MAX_PROMPT = 1500;
const ALL: Aspect[] = ["9:16", "1:1", "16:9"];

export const STUDIO_MODELS: StudioModel[] = [
  {
    key: "kling-2.5",
    name: "Kling 2.5 Turbo",
    blurb: "Fast and cheap, smooth motion",
    imageEndpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    textEndpoint: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    imageParam: "image_url",
    lengths: [5, 10],
    aspects: ALL,
    photoAspect: false,
    multiplier: 0.5, // $0.07/s
    seeded: false,
  },
  {
    key: "kling-3",
    name: "Kling 3 Pro",
    blurb: "Best quality and motion",
    imageEndpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    textEndpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    imageParam: "start_image_url",
    lengths: [5, 10],
    aspects: ALL,
    photoAspect: false,
    multiplier: 1, // $0.14/s, without its own sound
    seeded: false,
  },
  {
    key: "seedance",
    name: "Seedance Pro",
    blurb: "Sharp 1080p, good for products",
    imageEndpoint: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    textEndpoint: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
    imageParam: "image_url",
    lengths: [3, 5, 8, 10, 12],
    aspects: ALL,
    photoAspect: true,
    multiplier: 1, // token-priced, ~$0.12/s at 1080p
    seeded: true,
  },
  {
    key: "h3-turbo",
    name: "MiniMax H3 Turbo",
    blurb: "Cheapest, quick drafts",
    imageEndpoint: "minimax/h3-max-turbo/image-to-video",
    textEndpoint: "minimax/h3-max-turbo/image-to-video", // without a photo it makes a 16:9 clip from the prompt
    imageParam: "image_url",
    lengths: [5, 10],
    aspects: ["16:9"],
    photoAspect: false,
    multiplier: 0.5, // $0.025/s
    seeded: true,
  },
];

export type StudioRequest = { model: string; prompt: string; aspect: string; length: number; hasPhoto: boolean };

/** The checked request, or an Error with the words to show the user. */
export function validateRequest(
  r: StudioRequest,
  models: StudioModel[] = STUDIO_MODELS,
): { model: StudioModel; prompt: string; aspect: Aspect; length: number } {
  const prompt = r.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT) throw new Error("Describe the video first.");
  const model = models.find((m) => m.key === r.model);
  if (!model) throw new Error("Pick a model from the list.");
  if (!r.hasPhoto && !model.textEndpoint) throw new Error("Add a product photo for this model.");
  if (!model.lengths.includes(r.length)) throw new Error("Pick a length this model makes.");
  const followsPhoto = r.hasPhoto && !model.photoAspect;
  const aspect = r.aspect as Aspect;
  if (!(followsPhoto ? ALL : model.aspects).includes(aspect)) throw new Error("Pick a format this model makes.");
  return { model, prompt, aspect, length: r.length };
}

/** Allowance seconds a clip of this length uses. */
export function chargeFor(model: StudioModel, length: number): number {
  return Math.max(1, Math.ceil(length * model.multiplier));
}

/** The fal endpoint and request body for this clip. */
export function falInput(
  model: StudioModel,
  r: { prompt: string; aspect: Aspect; length: number },
  imageUrl: string | null,
  seed: number | null,
): { endpoint: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { prompt: r.prompt };
  if (imageUrl) body[model.imageParam] = imageUrl;
  if (model.aspects.length > 1 && (!imageUrl || model.photoAspect)) body.aspect_ratio = r.aspect;
  if (model.key === "h3-turbo") {
    body.duration = r.length;
    body.resolution = "1080P";
  } else {
    body.duration = String(r.length);
  }
  if (model.key === "seedance") body.resolution = "1080p";
  if (model.key === "kling-3") body.generate_audio = false;
  if (model.seeded && seed !== null) body.seed = seed;
  return { endpoint: imageUrl ? model.imageEndpoint : (model.textEndpoint ?? model.imageEndpoint), body };
}
