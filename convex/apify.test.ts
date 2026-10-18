/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { pickHeadline, runCostCap } from "./apify";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Apify Meta ads", () => {
  it("caps what one run may cost", () => {
    expect(runCostCap(50)).toBe(0.07);
    expect(runCostCap(10)).toBe(0.05);
    expect(runCostCap(50, "0.5")).toBe(0.5);
    expect(runCostCap(50, "nope")).toBe(0.07);
  });

  it("never uses template text such as {{product.name}} as the headline", () => {
    expect(pickHeadline("Instant Posture Corrector | 50% Off", undefined, undefined, "", "Corecare")).toBe("Instant Posture Corrector | 50% Off");
    expect(pickHeadline("{{product.name}}", "{{product.name}}", "Fix your posture in 7 days", "", "Corecare")).toBe("Fix your posture in 7 days");
    expect(pickHeadline("{{product.name}}", undefined, undefined, "{{product.brand}}\nSit straight again.", "Corecare")).toBe("Sit straight again.");
    expect(pickHeadline("{{product.name}}", undefined, undefined, "", "Corecare")).toBe("Corecare");
  });

  it("starts runs with the cost cap, then imports catalog ads with a real headline", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    vi.stubEnv("APIFY_COUNTRIES", "US");
    const started: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      if (url.includes("/runs?")) {
        started.push(url);
        return new Response(JSON.stringify({ data: { id: `run${started.length}`, status: "RUNNING" } }), { status: 201 });
      }
      if (url.includes("/datasets/")) {
        return new Response(JSON.stringify([{
          ad_archive_id: "123", page_name: "Corecare", start_date: 1781913600, is_active: true, publisher_platform: ["FACEBOOK", "INSTAGRAM"],
          snapshot: { title: "{{product.name}}", body: { text: "{{product.brand}}" }, link_url: "https://corecareshop.com/products/instant-posture-corrector", display_format: "DCO", cards: [] },
        }]), { status: 200 });
      }
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    const r = await t.action(internal.apify.dailyApifyImport, {});
    expect(r).toMatchObject({ started: 6, errors: [] });
    expect(started.every((u) => new URL(u).searchParams.get("maxTotalChargeUsd") === "0.07")).toBe(true);

    const run = await t.run(async (ctx) => (await ctx.db.query("apifyRuns").collect())[0]);
    await t.action(internal.apify.handleWebhook, { token: run.token, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    const ads = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ads).toHaveLength(1);
    expect(ads[0].headline).toBe("Corecare");
    expect(ads[0].bodyText).toBe("");
  });

  it("asks for EU details in EU countries and saves the EU reach and audience the spend estimate uses", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    vi.stubEnv("APIFY_COUNTRIES", "");
    const bodies: { scrapeAdDetails?: boolean }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/runs?")) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: { id: `run${bodies.length}`, status: "RUNNING" } }), { status: 201 });
      }
      if (url.includes("/datasets/")) {
        // Shape of a real row from a Danish search (2026-10), trimmed.
        return new Response(JSON.stringify([{
          ad_archive_id: "456", page_name: "SuppliPet", start_date: 1781913600, is_active: true, publisher_platform: ["FACEBOOK"],
          snapshot: { title: "Ledtilskud til hunde", body: { text: "Giv din hund bedre led" }, link_url: "https://supplipet.dk/products/led", cards: [] },
          aaa_info: {
            eu_total_reach: 208156,
            age_country_gender_reach_breakdown: [
              { country: "DK", age_gender_breakdowns: [{ age_range: "25-34", male: 40000, female: 60000, unknown: 0 }, { age_range: "35-44", male: 50000, female: 58156, unknown: 0 }] },
            ],
          },
        }]), { status: 200 });
      }
      return new Response("", { status: 404 });
    }));
    const t = convexTest(schema, modules);
    // No APIFY_COUNTRIES: the default five EU countries, 6 niches each.
    expect(await t.action(internal.apify.dailyApifyImport, {})).toMatchObject({ started: 30, errors: [] });
    expect(bodies.every((b) => b.scrapeAdDetails === true)).toBe(true);

    const run = await t.run(async (ctx) => (await ctx.db.query("apifyRuns").collect())[0]);
    await t.action(internal.apify.handleWebhook, { token: run.token, datasetId: "ds1", eventType: "ACTOR.RUN.SUCCEEDED" });
    const [ad] = await t.run((ctx) => ctx.db.query("ads").collect());
    expect(ad.audience?.totalReach).toBe(208156);
    expect(ad.audience?.countries).toEqual([{ code: "DK", pct: 100 }]);
    expect(ad.audience?.ages.map((a) => a.bracket)).toEqual(["25-34", "35-44"]);
  });

  it("can be switched off", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_test");
    vi.stubEnv("APIFY_COUNTRIES", "off");
    const t = convexTest(schema, modules);
    expect(await t.action(internal.apify.dailyApifyImport, {})).toEqual({ notConfigured: "APIFY_COUNTRIES is off" });
  });
});
