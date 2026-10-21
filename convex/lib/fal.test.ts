import { afterEach, describe, expect, it, vi } from "vitest";
import { FAL_MODELS, FalError, describeFalError, falModels, falResult, falStatus, falSubmit, videoUrlOf } from "./fal";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const job = { statusUrl: "https://queue.fal.run/fal-ai/x/requests/1/status", responseUrl: "https://queue.fal.run/fal-ai/x/requests/1" };

describe("fal queue client", () => {
  it("submits a job with the key and returns its links", async () => {
    const fetchMock = vi.fn(async () => json({ request_id: "1", status_url: job.statusUrl, response_url: job.responseUrl }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await falSubmit("k", "fal-ai/x", { a: 1 })).toEqual(job);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/x");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Key k");
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 });
  });

  it("maps queue statuses", async () => {
    for (const [status, want] of [["IN_QUEUE", "pending"], ["IN_PROGRESS", "pending"], ["COMPLETED", "done"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ status })));
      expect(await falStatus("k", job)).toBe(want);
    }
  });

  it("throws FalError on a failed call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "boom" }, 500)));
    const err = await falStatus("k", job).catch((e) => e);
    expect(err).toBeInstanceOf(FalError);
    expect(err).toMatchObject({ status: 500, body: { detail: "boom" } });
  });

  it("reads the result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ video: { url: "u" } })));
    expect(videoUrlOf(await falResult("k", job))).toBe("u");
  });

  it("finds the video link in both result shapes", () => {
    expect(videoUrlOf({ video: { url: "u" } })).toBe("u");
    expect(videoUrlOf({ video_url: "w" })).toBe("w");
    expect(videoUrlOf({})).toBeNull();
  });

  it("picks models, with env overrides", () => {
    expect(falModels({})).toEqual(FAL_MODELS);
    expect(falModels({ FAL_ACTOR_MODEL: "fal-ai/other" }).actor).toBe("fal-ai/other");
  });

  it("explains errors in plain words", () => {
    expect(describeFalError(422, {}, false)).toBe("The AI video service refused this photo. Try a plain product photo.");
    expect(describeFalError(422, { detail: "nsfw" }, true)).toBe("The AI video service refused this photo. Try a plain product photo. (fal: nsfw)");
    expect(describeFalError(401, {}, false)).toBe("The AI video service refused the key. Check FAL_KEY in Convex.");
    expect(describeFalError(403, {}, false)).toBe("The AI video service refused the key. Check FAL_KEY in Convex.");
    expect(describeFalError(402, {}, false)).toBe("The AI video service is out of credit.");
    expect(describeFalError(400, { detail: "Exhausted balance" }, false)).toBe("The AI video service is out of credit.");
    expect(describeFalError(429, {}, false)).toBe("The AI video service is busy. Try again in a minute.");
    expect(describeFalError(500, {}, false)).toBe("The AI video failed. Try again.");
  });
});
