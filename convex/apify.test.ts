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
});
