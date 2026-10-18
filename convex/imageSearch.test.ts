/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { Jimp } from "jimp";
import { EMBED_DIMENSIONS } from "./lib/adEmbeddings";

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

  it("falls back to plain JSON when structured output is rejected", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    const bodies: { output_config?: { format?: unknown } }[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad schema" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: 'Sure: {"isProduct": true, "productName": "led strip", "searchTerms": ["led strip"], "niche": "home & living"}' }],
          stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await t.withIdentity({ subject: "u1|s" }).action(api.imageSearch.search, { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(bodies[0].output_config?.format).toBeDefined();
    expect(bodies[1].output_config?.format).toBeUndefined();
    expect(r.identified).toMatchObject({ productName: "led strip", niche: "Home & Living" });
  });

  it("shows admins Anthropic's error text", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
    });
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "image too small" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      t.withIdentity({ subject: "a1|s" }).action(api.imageSearch.search, { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" }),
    ).rejects.toThrow(/image too small.*server key …test, ANTHROPIC_WORKSPACE_ID not set/);
  });

  it("sends the workspace header when ANTHROPIC_WORKSPACE_ID is set", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_123";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    let header: string | null = null;
    vi.stubGlobal("fetch", async (_url: unknown, init: { headers: HeadersInit }) => {
      header = new Headers(init.headers).get("anthropic-workspace-id");
      return new Response(
        JSON.stringify({
          id: "msg_3", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify({ isProduct: false, productName: "", searchTerms: [], niche: "Other" }) }],
          stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      await t.withIdentity({ subject: "u1|s" }).action(api.imageSearch.search, { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" });
      expect(header).toBe("wrkspc_123");
    } finally {
      delete process.env.ANTHROPIC_WORKSPACE_ID;
    }
  });

  it("matches the photo itself: look-alike ad images and AliExpress listings", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubEnv("VOYAGE_API_KEY", "voyage_test");
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    const unit = (axis: number) => Array.from({ length: EMBED_DIMENSIONS }, (_, i) => (i === axis ? 1 : 0));
    const t = convexTest(schema, modules);
    const [mat, shoe] = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const ad = {
        platform: "Facebook", country: "DK", niche: "Pet Supplies", bodyText: "", creativeUrl: "https://cdn.example.com/a.png", landingPageUrl: "",
        spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
        firstSeenAt: "2026-10-01T00:00:00.000Z", source: "apify",
      };
      const a = await ctx.db.insert("ads", { ...ad, advertiserName: "PawCool", headline: "Cooling mat" });
      const b = await ctx.db.insert("ads", { ...ad, advertiserName: "ShoeCo", headline: "Running shoe", niche: "Fashion" });
      await ctx.db.insert("adEmbeddings", { adId: a, embedding: unit(0), niche: "Pet Supplies", model: "voyage-multimodal-3.5" });
      await ctx.db.insert("adEmbeddings", { adId: b, embedding: unit(7), niche: "Fashion", model: "voyage-multimodal-3.5" });
      return [a, b];
    });
    const sentToApify: { imageUrl?: string }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      if (url.startsWith("https://api.voyageai.com/")) return Response.json({ data: [{ index: 0, embedding: unit(0) }] });
      if (url.includes("/acts/dev00~alibaba-1688-aliexpress-reverse-image-search-api/")) {
        sentToApify.push(JSON.parse(String(init?.body)));
        return Response.json([{ site: "aliexpress", title: "Pet cooling mat summer", price: 8.5, currency: "USD", productUrl: "https://www.aliexpress.com/item/42.html" }]);
      }
      return new Response(
        JSON.stringify({
          id: "msg_4", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify({ isProduct: true, productName: "dog cooling mat", searchTerms: ["cooling mat"], niche: "Pet Supplies" }) }],
          stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const png = (await new Jimp({ width: 40, height: 30, color: 0x3366ccff }).getBuffer("image/png")).toString("base64");
    const r = await t.withIdentity({ subject: "u1|s" }).action(api.imageSearch.search, { imageBase64: png, mediaType: "image/png" });
    expect(r.lookAlikes.map((a) => a._id)).toEqual([mat]);
    expect(r.lookAlikes.some((a) => a._id === shoe)).toBe(false);
    // The same ad isn't listed twice.
    expect(r.ads.some((a) => a._id === mat)).toBe(false);
    expect(r.suppliers).toEqual([{ title: "Pet cooling mat summer", price: 8.5, url: "https://www.aliexpress.com/item/42.html" }]);
    expect(sentToApify[0].imageUrl).toMatch(/^https?:\/\//);
    // The photo was only stored for the call.
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("rejects non-images and signed-out users", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const t = convexTest(schema, modules);
    await expect(t.action(api.imageSearch.search, { imageBase64: "x", mediaType: "application/pdf" })).rejects.toThrow(/JPG, PNG/);
    await expect(t.action(api.imageSearch.search, { imageBase64: "x", mediaType: "image/png" })).rejects.toThrow(/sign in/);
  });
});
