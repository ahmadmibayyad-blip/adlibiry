/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Jimp } from "jimp";
import schema from "./schema";
import { api } from "./_generated/api";
import { EMBED_DIMENSIONS } from "./lib/adEmbeddings";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const unit = (axis: number, lean = 0) => Array.from({ length: EMBED_DIMENSIONS }, (_, i) => (i === axis ? 1 : i === axis + 1 ? lean : 0));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("Who else sells this: same picture", () => {
  it("finds stores in the country whose ads show the same product picture", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "voyage-test");
    const png = await new Jimp({ width: 40, height: 30, color: 0x3366ccff }).getBuffer("image/png");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url === "https://cdn.shopify.com/zolen.jpg") return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      if (url.startsWith("https://api.voyageai.com/")) return json({ data: [{ index: 0, embedding: unit(0) }] });
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", plan: "pro", subscriptionStatus: "active" });
      const base = {
        platform: "Facebook", niche: "Health & Wellness", bodyText: "", landingPageUrl: "", spendEstimate: "", likes: 0, views: "0", daysRunning: 1,
        aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] }, firstSeenAt: "2026-10-01T00:00:00.000Z", source: "apify",
      };
      const add = async (host: string, country: string, embedding: number[]) => {
        const id = await ctx.db.insert("ads", { ...base, country, landingHost: host, advertiserName: host, headline: `Ad ${host}`, creativeUrl: `https://img/${host}.jpg` });
        await ctx.db.insert("adEmbeddings", { adId: id, embedding, niche: base.niche, model: "voyage-multimodal-3.5" });
      };
      await add("einlage.de", "DE", unit(0));
      await add("relivex.nl", "DE", unit(0)); // the store asked about
      await add("einlage.dk", "DK", unit(0)); // another country
      await add("schuhe.de", "DE", unit(5)); // another product
    });
    const user = t.withIdentity({ subject: "u1|s" });
    const r = await user.action(api.whoElse.samePicture, { imageUrl: "https://cdn.shopify.com/zolen.jpg", country: "de", excludeHost: "relivex.nl" });
    expect(r).toEqual({ stores: [expect.objectContaining({ host: "einlage.de", ads: 1, match: 100, image: "https://img/einlage.de.jpg" })] });
  });

  it("says when picture search isn't set up, and needs sign-in", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    expect(await t.withIdentity({ subject: "u1|s" }).action(api.whoElse.samePicture, { imageUrl: "https://x/y.jpg", country: "DE", excludeHost: "a.nl" })).toEqual({
      stores: [],
      skipped: "Picture matching isn't set up yet (VOYAGE_API_KEY).",
    });
    await expect(t.action(api.whoElse.samePicture, { imageUrl: "https://x/y.jpg", country: "DE", excludeHost: "a.nl" })).rejects.toThrow(/sign in/i);
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
