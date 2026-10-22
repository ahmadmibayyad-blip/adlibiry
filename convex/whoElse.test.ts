/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Jimp } from "jimp";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { EMBED_DIMENSIONS } from "./lib/adEmbeddings";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const unit = (axis: number, lean = 0) => Array.from({ length: EMBED_DIMENSIONS }, (_, i) => (i === axis ? 1 : i === axis + 1 ? lean : 0));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("Who else sells this: picture check on Meta's results", () => {
  async function searchRow(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const st = (host: string, image: string) => ({ host, advertisers: [host], ads: 1, copies: 1, oldestDays: 3, offers: [], productPaths: [], sample: [{ id: host, headline: "h", image, days: 3, offers: [] }] });
      return await ctx.db.insert("offerSearches", {
        userId, key: "SE|~powervest", country: "SE", phrases: ["PowerVest"], status: "done", createdAt: new Date().toISOString(), loose: true,
        productImage: "https://cdn.shopify.com/vest.jpg", pictureStatus: "running",
        stores: [st("north-alpine.com", "https://img/north.jpg"), st("dramabox.com", "https://img/drama.jpg")],
      });
    });
  }

  it("scores each store by how much its ad pictures look like the product photo", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "voyage-test");
    const png = await new Jimp({ width: 40, height: 30, color: 0x3366ccff }).getBuffer("image/png");
    const sent: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.startsWith("https://api.voyageai.com/")) {
        sent.push(JSON.parse(String(init?.body)).inputs.length);
        // In order: the product photo, north-alpine's ad picture, dramabox's.
        return json({ data: [unit(0), unit(0, 0.1), unit(5)].map((embedding, index) => ({ index, embedding })) });
      }
      return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    }));
    const t = convexTest(schema, modules);
    const id = await searchRow(t);
    await t.action(internal.whoElse.matchPictures, { id });
    const row = (await t.run((ctx) => ctx.db.get("offerSearches", id)))!;
    expect(sent).toEqual([3]);
    expect(row.pictureStatus).toBe("done");
    expect((row.stores as { host: string; match?: number }[]).map((st) => [st.host, st.match])).toEqual([["north-alpine.com", 100], ["dramabox.com", 0]]);
  });

  it("says when picture matching isn't set up", async () => {
    const t = convexTest(schema, modules);
    const id = await searchRow(t);
    await t.action(internal.whoElse.matchPictures, { id });
    expect(await t.run((ctx) => ctx.db.get("offerSearches", id))).toMatchObject({ pictureStatus: "skipped" });
  });
});

describe("Who else sells this: shopper keywords", () => {
  it("asks for the words shoppers in that country use, from what the product is", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      asked.push(String(init?.body));
      return json({
        id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5",
        content: [{ type: "text", text: "1. Magnetische Einlegesohlen\n2. Abnehm Einlagen\n3. Einlegesohlen Magnet" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      });
    }));
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const user = t.withIdentity({ subject: "u1|s" });
    const r = await user.action(api.whoElse.keywords, { title: "ReliveX™ Magnetische Inlegzolen | Verlies Gewicht", supplierTitle: "Magnetic therapy insoles weight loss", country: "DE" });
    expect(r).toEqual({ keywords: ["Magnetische Einlegesohlen", "Abnehm Einlagen", "Einlegesohlen Magnet"] });
    expect(asked[0]).toContain("German");
    expect(asked[0]).toContain("Magnetic therapy insoles weight loss");
    expect(await user.action(api.whoElse.keywords, { title: "x", country: "PL" }).catch((e) => e.data)).toMatchObject({ code: "BAD_COUNTRY" });
  });
});
