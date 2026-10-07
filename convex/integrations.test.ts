/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const DAY = "2026-10-07";
const product = {
  description: "", tags: [], saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false,
  publishedAt: "2026-09-01T00:00:00.000Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Meta Ad Library import", () => {
  it("stops at the first token error with a plain message, and skips countries the API can't serve", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "expired");
    vi.stubEnv("META_AD_COUNTRIES", "DE,US");
    const calls = vi.fn(async () => json({ error: { code: 190, message: "Error validating access token: Session has expired" } }, 400));
    vi.stubGlobal("fetch", calls);
    const t = convexTest(schema, modules);
    const r = await t.action(internal.metaAdLibrary.dailyImport, {});
    expect(calls).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ fetched: 0 });
    const errors = (r as { errors: string[] }).errors;
    expect(errors[0]).toMatch(/^Meta token expired or invalid \(code 190\)/);
    expect(errors[1]).toMatch(/Skipped US/);
  });
});

describe("AdLibrary", () => {
  it("can be paused for the daily sync", async () => {
    vi.stubEnv("ADLIBRARY_API_KEY", "al_test");
    vi.stubEnv("ADLIBRARY_PAUSED", "true");
    const t = convexTest(schema, modules);
    await t.action(internal.importRuns.run, { job: "adlibrary" });
    const [row] = await t.run((ctx) => ctx.db.query("importRuns").collect());
    expect(row).toMatchObject({ status: "skipped", summary: "Paused (ADLIBRARY_PAUSED is set)" });
  });

  it("hands the missing-ads lookup to Meta's API when AdLibrary is out of credits", async () => {
    vi.stubEnv("ADLIBRARY_API_KEY", "al_test");
    vi.stubEnv("META_ACCESS_TOKEN", "meta_test");
    const hosts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) => {
      const host = new URL(String(u)).hostname;
      hosts.push(host);
      if (host === "adlibrary.com") return new Response("no credits", { status: 402 });
      if (host === "graph.facebook.com") return json({ data: [{ id: "9", page_name: "Corecare", ad_delivery_start_time: "2026-09-01" }] });
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("products", { ...product, title: "Instant Posture Corrector", imageUrl: "", category: "Health & Wellness", aiScore: 60, source: "shopify", unitsPerMonth: 800, storeHost: "corecareshop.com" }),
    );
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.backfill.done).toBe(1);
    expect(r.backfill.errors[0]).toBe("AdLibrary is out of credits; switched to Meta's API");
    expect(hosts).toEqual(expect.arrayContaining(["adlibrary.com", "graph.facebook.com"]));
    expect((await t.run((ctx) => ctx.db.query("ads").collect()))[0]).toMatchObject({ source: "meta_ad_library", advertiserName: "Corecare" });
  });
});

describe("Nexscope image matches", () => {
  it("finds an ad-only winner's Amazon twin and its 1688 suppliers", async () => {
    vi.stubEnv("NEXSCOPE_API_KEY", "nk_test");
    const skills: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) => {
      const url = String(u);
      if (url.includes("reverse-product-image-search")) {
        skills.push("twin");
        return json({ code: 0, data: { products: [{ asin: "B0ABC12345", title: "Posture Corrector", price: 24.99, monthlySales: 3200 }] } });
      }
      if (url.includes("1688-search-by-image")) {
        skills.push("1688");
        return json({ products: [{ subject: "Posture belt", price: 14.2, offerId: "222", moq: 2 }] });
      }
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const p = await ctx.db.insert("products", { ...product, title: "Posture corrector", imageUrl: "https://cdn.example.com/p.jpg", category: "Health & Wellness", aiScore: 90, source: "ads" });
      await ctx.db.insert("winningProducts", { productId: p, niche: "Health & Wellness", nicheRank: 1, position: 0, score: 90, enteredDay: DAY });
      return p;
    });
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.twin).toMatchObject({ done: 1, errors: [] });
    expect(r.wholesale).toMatchObject({ done: 1, errors: [] });
    const p = await t.run((ctx) => ctx.db.get("products", id));
    expect(p?.marketplaceMatch).toMatchObject({ asin: "B0ABC12345", unitsPerMonth: 3200 });
    expect(p?.wholesaleMatches?.[0]).toMatchObject({ title: "Posture belt", priceUsd: 2, moq: 2, url: "https://detail.1688.com/offer/222.html" });
    // Checked once; not asked again the next day.
    await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(skills).toEqual(["twin", "1688"]);
  });

  it("reports the fields of a reply it can't read, so the mapping can be fixed", async () => {
    vi.stubEnv("NEXSCOPE_API_KEY", "nk_test");
    vi.stubGlobal("fetch", vi.fn(async (u: URL | string) =>
      String(u).includes("reverse-product-image-search") ? json({ products: [{ sku: "x", label: "y" }] }) : json({ products: [] }),
    ));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const p = await ctx.db.insert("products", { ...product, title: "Mat", imageUrl: "https://cdn.example.com/m.jpg", category: "Pet Supplies", aiScore: 80, source: "ads" });
      await ctx.db.insert("winningProducts", { productId: p, niche: "Pet Supplies", nicheRank: 1, position: 0, score: 80, enteredDay: DAY });
    });
    const r = await t.action(internal.fusion.runTriggers, { day: DAY });
    expect(r.twin.errors).toEqual(["No usable match. Fields sent: sku, label"]);
  });

  it("is visible to admins in the source fusion summary", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" }));
    await t.action(internal.fusion.runTriggers, { day: DAY });
    const s = await t.withIdentity({ subject: "admin1|s" }).query(api.fusion.adminSummary, {});
    expect(s.lastRun?.twin?.skipped).toBe("NEXSCOPE_API_KEY isn't set");
    expect(s.lastRun?.wholesale?.skipped).toBe("NEXSCOPE_API_KEY isn't set");
  });
});
