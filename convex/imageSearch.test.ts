/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// Fake Claude: says the photo is a dog cooling mat.
function stubClaude(answer: object) {
  vi.stubGlobal("fetch", async () =>
    new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("image search", () => {
  it("identifies the product and finds matching products", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("products", {
        title: "Dog Cooling Mat for Summer", description: "", imageUrl: "i", category: "Pet Supplies", tags: [], aiScore: 80,
        saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
      });
    });
    stubClaude({ isProduct: true, productName: "dog cooling mat", searchTerms: ["cooling mat", "pet cooling pad"], niche: "Pet Supplies" });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.imageSearch.search, { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(r.identified).toMatchObject({ productName: "dog cooling mat", niche: "Pet Supplies" });
    expect(r.products.map((p) => p.title)).toEqual(["Dog Cooling Mat for Summer"]);
  });

  it("rejects non-images and signed-out users", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await expect(t.action(api.imageSearch.search, { imageBase64: "x", mediaType: "application/pdf" })).rejects.toThrow(/JPG, PNG/);
    await expect(t.action(api.imageSearch.search, { imageBase64: "x", mediaType: "image/png" })).rejects.toThrow(/sign in/);
  });
});
