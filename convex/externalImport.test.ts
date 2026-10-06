/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("admin ad import", () => {
  it("saves rows with empty text fields (e.g. product exports with no landing page)", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a", role: "admin" }));
    const row = {
      externalId: "csv:unknown advertiser|https://img/1.jpg", source: "csv_import", advertiserName: "Unknown advertiser",
      platform: "Facebook", country: "US", niche: "Other", headline: "Cool mat", bodyText: "", creativeUrl: "https://img/1.jpg",
      landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "—", daysRunning: 0, aiScore: 1, firstSeenAt: "2026-10-03T00:00:00.000Z",
    };
    const r = await t.withIdentity({ subject: "a|s" }).mutation(api.admin.externalImport.importAds, { ads: [row], refreshFirstSeen: true });
    expect(r).toEqual({ created: 1, updated: 0 });
    const ad = await t.run(async (ctx) => (await ctx.db.query("ads").collect())[0]);
    expect(ad).toMatchObject({ headline: "Cool mat", landingPageUrl: "", bodyText: "", creativeUrl: "https://img/1.jpg" });
  });
});
