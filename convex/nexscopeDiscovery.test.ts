/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { NICHE_DISCOVERY_KEYWORDS } from "./nexscope/client";

const modules = import.meta.glob("./**/*.ts");

// Fake Nexscope: 3 usable listings per search, unique per keyword.
function stubNexscope(searched: string[]) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { keyword } = JSON.parse(String(init.body)) as { keyword: string };
    searched.push(keyword);
    const slug = keyword.replace(/\W+/g, "-");
    const products = [1, 2, 3].map((n) => ({
      asin: `${slug}-${n}`,
      title: `${keyword} model ${n}`,
      price: 20 + n,
      imageUrl: `https://img.example.com/${slug}-${n}.jpg`,
    }));
    products.push({ asin: "", title: "no asin", price: 1, imageUrl: "" }); // unusable
    return new Response(JSON.stringify({ products }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Nexscope product discovery", () => {
  it("saves every usable listing and searches a new keyword each run", async () => {
    process.env.NEXSCOPE_API_KEY = "test";
    const t = convexTest(schema, modules);
    const searched: string[] = [];
    stubNexscope(searched);
    const niches = Object.keys(NICHE_DISCOVERY_KEYWORDS).length;

    const first = await t.action(internal.nexscope.productDiscovery.discoverProducts, {});
    expect(first).toMatchObject({ created: 3 * niches, updated: 0, skipped: niches, errors: [] });

    const second = await t.action(internal.nexscope.productDiscovery.discoverProducts, {});
    expect(second.created).toBe(3 * niches); // different keywords → new products
    expect(new Set(searched).size).toBe(2 * niches);

    const picks = await t.run((ctx) => ctx.db.query("products").withIndex("by_winner", (q) => q.eq("isWinnerOfDay", true)).collect());
    expect(picks).toHaveLength(2 * niches); // only the latest run's top 2 per niche
  });
});
