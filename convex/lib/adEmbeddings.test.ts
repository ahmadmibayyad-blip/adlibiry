import { describe, expect, it } from "vitest";
import { EMBED_DIMENSIONS, SIMILAR_MIN_SCORE, dailyImageCap, describeVoyageError, parseVoyage, pickSimilar, voyageBody } from "./adEmbeddings";

const vec = (x: number) => Array.from({ length: EMBED_DIMENSIONS }, () => x);

describe("Voyage request and reply", () => {
  it("sends images as base64 documents", () => {
    expect(voyageBody(["data:image/jpeg;base64,AAA"])).toEqual({
      model: "voyage-multimodal-3.5",
      input_type: "document",
      inputs: [{ content: [{ type: "image_base64", image_base64: "data:image/jpeg;base64,AAA" }] }],
    });
  });

  it("puts vectors back in request order and rejects bad replies", () => {
    const reply = { data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }] };
    expect(parseVoyage(reply, 2)?.map((v) => v[0])).toEqual([1, 2]);
    expect(parseVoyage(reply, 3)).toBeNull();
    expect(parseVoyage({ data: [{ index: 0, embedding: [1, 2] }] }, 1)).toBeNull();
    expect(parseVoyage(null, 1)).toBeNull();
  });

  it("stops on key, credit and rate problems only", () => {
    expect(describeVoyageError(401, {}).stop).toBe(true);
    expect(describeVoyageError(429, { detail: "slow down" })).toMatchObject({ stop: true, message: expect.stringContaining("slow down") });
    expect(describeVoyageError(400, {}).stop).toBe(false);
  });

  it("reads the daily cap", () => {
    expect(dailyImageCap(undefined)).toBe(3000);
    expect(dailyImageCap("250")).toBe(250);
    expect(dailyImageCap("lots")).toBe(3000);
  });
});

describe("pickSimilar", () => {
  const hit = (name: string, score: number, extra: Partial<{ sameImage: boolean; self: boolean }> = {}) => ({
    ad: { advertiserName: name, id: `${name}-${score}` },
    score,
    sameImage: false,
    self: false,
    ...extra,
  });

  it("drops itself, copies and weak matches, best first, two per advertiser", () => {
    const picked = pickSimilar([
      hit("A", 0.99, { self: true }),
      hit("B", 0.97, { sameImage: true }),
      hit("C", 0.7),
      hit("C", 0.9),
      hit("C", 0.8),
      hit("D", 0.6),
      hit("E", SIMILAR_MIN_SCORE - 0.01),
    ]);
    expect(picked.map((p) => p.ad.id)).toEqual(["C-0.9", "C-0.8", "D-0.6"]);
  });

  it("respects the limit", () => {
    expect(pickSimilar([hit("A", 0.9), hit("B", 0.8)], 1)).toHaveLength(1);
  });
});
