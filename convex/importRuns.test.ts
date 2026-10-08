/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { summarizeRun } from "./lib/importRuns";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("summarizeRun", () => {
  it("reads counts, errors and skips from an import's result", () => {
    expect(summarizeRun({ result: { created: 3, updated: 1, errors: [] } })).toEqual({ status: "ok", summary: "created 3, updated 1", errors: [] });
    expect(summarizeRun({ result: { created: 2, errors: ["DK: 402 out of credits"] } })).toMatchObject({ status: "partial", errors: ["DK: 402 out of credits"] });
    expect(summarizeRun({ result: { created: 0, errors: ["401 bad key"] } })).toMatchObject({ status: "failed" });
    expect(summarizeRun({ result: { notConfigured: "APIFY_COUNTRIES is not set" } })).toEqual({ status: "skipped", summary: "APIFY_COUNTRIES is not set", errors: [] });
    expect(summarizeRun({ thrown: new Error("boom") })).toEqual({ status: "failed", summary: "Stopped with an error", errors: ["boom"] });
    expect(summarizeRun({ result: { errors: Array.from({ length: 30 }, (_, i) => `e${i}`) } }).errors).toHaveLength(10);
  });
});

describe("daily import run log", () => {
  it("records a job that isn't set up as skipped, visible to admins only", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.importRuns.run, { job: "winninghunter" });
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" });
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    const runs = await t.withIdentity({ subject: "admin1|s" }).query(api.importRuns.latest, {});
    expect(runs.find((r) => r.job === "winninghunter")?.last).toMatchObject({ status: "skipped", summary: "WINNINGHUNTER_API_KEY is not set" });
    expect(runs.find((r) => r.job === "apify")?.last).toBeNull();
    await expect(t.withIdentity({ subject: "u1|s" }).query(api.importRuns.latest, {})).rejects.toThrow();
  });

  it("lets an admin run one import now; it's logged like a scheduled run", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" });
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    await expect(t.withIdentity({ subject: "u1|s" }).mutation(api.importRuns.runNow, { job: "metaAdLibrary" })).rejects.toThrow();
    await t.withIdentity({ subject: "admin1|s" }).mutation(api.importRuns.runNow, { job: "metaAdLibrary" });
    await settle(t);
    const runs = await t.withIdentity({ subject: "admin1|s" }).query(api.importRuns.latest, {});
    expect(runs.find((r) => r.job === "metaAdLibrary")?.last).toMatchObject({ status: "skipped", summary: "META_ACCESS_TOKEN isn't set (Meta Ad Library API)" });
  });

  it("keeps importing other countries after one fails, and logs every failure", async () => {
    vi.stubEnv("NEXSCOPE_TIKTOK_COUNTRIES", "gb,de");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const t = convexTest(schema, modules);
    await t.action(internal.importRuns.run, { job: "nexscopeTikTok" });
    const [row] = await t.run((ctx) => ctx.db.query("importRuns").collect());
    expect(row).toMatchObject({ job: "nexscopeTikTok", status: "failed" });
    expect(row.errors.length).toBeGreaterThan(1);
    expect(row.errors.some((e) => e.startsWith("gb/"))).toBe(true);
    expect(row.errors.some((e) => e.startsWith("de/"))).toBe(true);
  });
});
