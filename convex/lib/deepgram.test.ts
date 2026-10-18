import { describe, expect, it } from "vitest";
import { readDeepgram } from "./deepgram";

const w = (word: string, start: number) => ({ word, punctuated_word: word, start, end: start + 0.3 });

describe("readDeepgram", () => {
  it("takes the transcript and the hook from the first 3 seconds", () => {
    const body = { results: { channels: [{ alternatives: [{ transcript: " Stop scrolling. This mat cools your dog. ", words: [w("Stop", 0.1), w("scrolling.", 0.5), w("This", 3.5)] }] }] } };
    expect(readDeepgram(body)).toEqual({ transcript: "Stop scrolling. This mat cools your dog.", hook: "Stop scrolling." });
  });

  it("is empty when nothing is said or the answer is unreadable", () => {
    expect(readDeepgram({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } })).toEqual({});
    expect(readDeepgram(null)).toEqual({});
  });
});
