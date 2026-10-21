// fal.ai queue API for Remake this winner (convex/remake.ts), with plain fetch:
// POST https://queue.fal.run/<model> (header "Authorization: Key <FAL_KEY>")
// answers with status_url and response_url, which we poll and read. Always use
// those links: sub-path models answer under their base app id.

export const FAL_QUEUE_URL = "https://queue.fal.run";
export const FAL_MODELS = {
  actor: "fal-ai/bytedance/omnihuman/v1.5", // portrait + audio → lip-synced video, $0.16/s
  product: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
  compose: "fal-ai/ffmpeg-api/compose",
};

export type FalJob = { statusUrl: string; responseUrl: string };

export class FalError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`fal ${status}`);
  }
}

/** The models to use (FAL_ACTOR_MODEL / FAL_PRODUCT_MODEL override). */
export function falModels(env: Record<string, string | undefined>): typeof FAL_MODELS {
  return {
    actor: env.FAL_ACTOR_MODEL?.trim() || FAL_MODELS.actor,
    product: env.FAL_PRODUCT_MODEL?.trim() || FAL_MODELS.product,
    compose: FAL_MODELS.compose,
  };
}

async function call(key: string, url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Key ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new FalError(res.status, parsed);
  return parsed;
}

export async function falSubmit(key: string, model: string, input: unknown): Promise<FalJob> {
  const body = (await call(key, `${FAL_QUEUE_URL}/${model}`, input)) as { status_url?: unknown; response_url?: unknown } | null;
  if (typeof body?.status_url !== "string" || typeof body.response_url !== "string") throw new FalError(502, body);
  return { statusUrl: body.status_url, responseUrl: body.response_url };
}

export async function falStatus(key: string, job: FalJob): Promise<"pending" | "done"> {
  const body = (await call(key, job.statusUrl)) as { status?: unknown } | null;
  if (body?.status === "IN_QUEUE" || body?.status === "IN_PROGRESS") return "pending";
  if (body?.status === "COMPLETED") return "done";
  throw new FalError(502, body);
}

export async function falResult(key: string, job: FalJob): Promise<unknown> {
  return await call(key, job.responseUrl);
}

/** Ask fal to stop a job (best effort: a job that already finished or can't be stopped is left alone). */
export async function falCancel(key: string, job: FalJob): Promise<void> {
  try {
    await fetch(job.statusUrl.replace(/\/status$/, "/cancel"), {
      method: "PUT",
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* nothing more to do */
  }
}

/** A brief failure worth polling again (rate limit, fal outage, timeout, network), not a refusal. */
export function isTransient(error: unknown): boolean {
  if (error instanceof FalError) return error.status === 429 || error.status >= 500;
  if (error instanceof DOMException) return error.name === "TimeoutError" || error.name === "AbortError";
  return error instanceof TypeError;
}

/** The video link in a fal result: `video.url` (models) or `video_url` (compose). */
export function videoUrlOf(body: unknown): string | null {
  const b = (body ?? {}) as { video?: { url?: unknown }; video_url?: unknown };
  if (typeof b.video?.url === "string") return b.video.url;
  return typeof b.video_url === "string" ? b.video_url : null;
}

/** A fal error in the user's words; admins also see fal's own message. */
export function describeFalError(status: number, body: unknown, admin: boolean): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const msg = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "";
  const extra = admin && msg ? ` (fal: ${msg.slice(0, 160)})` : "";
  if (status === 401 || status === 403) return `The AI video service refused the key. Check FAL_KEY in Convex.${extra}`;
  if (status === 402 || /balance|credit/i.test(msg)) return `The AI video service is out of credit.${extra}`;
  if (status === 422) return `The AI video service refused this photo. Try a plain product photo.${extra}`;
  if (status === 429) return `The AI video service is busy. Try again in a minute.${extra}`;
  return `The AI video failed. Try again.${extra}`;
}
