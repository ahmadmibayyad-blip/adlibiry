/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Jimp } from "jimp";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { EMBED_DIMENSIONS } from "./lib/adEmbeddings";

const modules = import.meta.glob("./**/*.ts");

type NewAd = Omit<Doc<"ads">, "_id" | "_creationTime">;
const ad = (over: Partial<NewAd>): NewAd => ({
  advertiserName: "Paws & Co",
  platform: "Facebook",
  country: "DK",
  niche: "Pet Supplies",
  headline: "Keep your dog cool",
  bodyText: "No water, no power.",
  creativeUrl: "https://cdn.example.com/a.png",
  landingPageUrl: "https://paws.example.com/",
  spendEstimate: "Unknown",
  likes: 0,
  views: "0",
  daysRunning: 10,
  aiScore: 50,
  targeting: { ageRange: "Unknown", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  source: "apify",
  ...over,
});

// A unit vector pointing mostly along `axis`, so similarity is easy to control.
const vector = (axis: number, tilt = 0) => {
  const v = Array.from({ length: EMBED_DIMENSIONS }, () => 0);
  v[axis] = 1;
  v[(axis + 1) % EMBED_DIMENSIONS] = tilt;
  return v;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Looks similar", () => {
  it("embeds ad images once a day and finds the nearest other creatives", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    const png = await (new Jimp({ width: 600, height: 400, color: 0x3366ccff })).getBuffer("image/png");
    // Each image URL's vector: dog-1/dog-2 point the same way, the shoe elsewhere.
    const vectors: Record<string, number[]> = {
      "https://cdn.example.com/dog-1.png": vector(0),
      "https://cdn.example.com/dog-2.png": vector(0, 0.3),
      "https://cdn.example.com/shoe.png": vector(5),
    };
    let sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.voyageai.com/")) {
          const body = JSON.parse(String(init?.body));
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
          const urls = sent;
          sent = [];
          return new Response(
            JSON.stringify({ data: body.inputs.map((_: unknown, i: number) => ({ index: i, embedding: vectors[urls[i]] })) }),
            { status: 200 },
          );
        }
        if (url.includes("broken")) return new Response("nope", { status: 404 });
        sent.push(url);
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }),
    );

    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" }));
    const ids = await t.run(async (ctx) => ({
      dog1: await ctx.db.insert("ads", ad({ creativeUrl: "https://cdn.example.com/dog-1.png" })),
      dog2: await ctx.db.insert("ads", ad({ advertiserName: "Pet Palace", creativeUrl: "https://cdn.example.com/dog-2.png" })),
      shoe: await ctx.db.insert("ads", ad({ advertiserName: "Shoe Co", creativeUrl: "https://cdn.example.com/shoe.png" })),
      broken: await ctx.db.insert("ads", ad({ advertiserName: "Gone", creativeUrl: "https://cdn.example.com/broken.png" })),
      noImage: await ctx.db.insert("ads", ad({ advertiserName: "Text Only", creativeUrl: "" })),
    }));

    vi.stubEnv("VOYAGE_DAILY_IMAGES", "100");
    const run = await t.action(internal.adEmbeddingsAction.dailyEmbed, {});
    expect(run).toMatchObject({ fetched: 5, updated: 3, errors: [] });
    const statuses = await t.run(async (ctx) =>
      Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await ctx.db.get("ads", id))?.embedStatus]))),
    );
    expect(statuses).toEqual({ dog1: "done", dog2: "done", shoe: "done", broken: "failed", noImage: "none" });

    const user = t.withIdentity({ subject: "u1|s" });
    const similar = await user.action(api.adEmbeddings.looksSimilar, { adId: ids.dog1 });
    expect(similar?.status).toBe("ok");
    expect(similar?.ads.map((a) => a.advertiserName)).toEqual(["Pet Palace"]);
    expect((await user.action(api.adEmbeddings.looksSimilar, { adId: ids.noImage }))?.status).toBe("none");

    // Nothing left: the next run sends nothing.
    expect(await t.action(internal.adEmbeddingsAction.dailyEmbed, {})).toMatchObject({ fetched: 0, updated: 0 });
  });

  it("says when it isn't set up, and needs sign-in to look up", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "");
    const t = convexTest(schema, modules);
    expect(await t.action(internal.adEmbeddingsAction.dailyEmbed, {})).toEqual({ notConfigured: "VOYAGE_API_KEY isn't set (Looks similar)" });
    const id = await t.run((ctx) => ctx.db.insert("ads", ad({})));
    await expect(t.action(api.adEmbeddings.looksSimilar, { adId: id })).rejects.toThrow(/sign in/);
  });
});
