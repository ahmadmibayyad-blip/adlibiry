/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const row = (i: number, firstSeenAt: string) => ({
  externalId: `csv:adv${i}|https://img/${i}.jpg`, source: "csv_import", advertiserName: `adv${i}`,
  platform: "Facebook", country: "US", niche: "Other", headline: `Ad ${i}`, bodyText: "", creativeUrl: `https://img/${i}.jpg`,
  landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 0, aiScore: 1, firstSeenAt,
});

describe("remove last ad CSV import", () => {
  it("deletes only the newest import, in batches", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
    const admin = t.withIdentity({ subject: "a|s" });
    const OLD = "2026-10-01T00:00:00.000Z";
    const NEW = "2026-10-03T00:00:00.000Z";
    await admin.mutation(api.admin.externalImport.importAds, { ads: [1, 2].map((i) => row(i, OLD)), refreshFirstSeen: true });
    for (let b = 0; b < 3; b++) {
      const ads = Array.from({ length: 100 }, (_, k) => row(100 + b * 100 + k, NEW)).slice(0, b === 2 ? 50 : 100);
      await admin.mutation(api.admin.externalImport.importAds, { ads, refreshFirstSeen: true });
    }

    expect(await admin.query(api.admin.importCleanup.lastAdImport, {})).toEqual({ at: NEW, count: 250 });
    expect(await admin.mutation(api.admin.importCleanup.removeAdImport, { at: NEW })).toEqual({ deleted: 200, remaining: 50 });
    expect(await admin.mutation(api.admin.importCleanup.removeAdImport, { at: NEW })).toEqual({ deleted: 50, remaining: 0 });

    const left = await t.run(async (ctx) => ({
      ads: (await ctx.db.query("ads").collect()).map((a) => a.firstSeenAt),
      links: (await ctx.db.query("syncLinks").collect()).length,
    }));
    expect(left.ads).toEqual([OLD, OLD]);
    expect(left.links).toBe(2);
    expect(await admin.query(api.admin.importCleanup.lastAdImport, {})).toEqual({ at: OLD, count: 2 });
  });

  it("is admin only", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u", role: "user" }));
    await expect(t.withIdentity({ subject: "u|s" }).query(api.admin.importCleanup.lastAdImport, {})).rejects.toThrow();
  });
});
