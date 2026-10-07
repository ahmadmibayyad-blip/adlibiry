/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

const syncArgs = {
  advertiserName: "Glow Co", platform: "Facebook", country: "DK", niche: "Home & Living", headline: "Glow lamp",
  bodyText: "Best lamp ever", creativeUrl: "https://cdn.example.com/a.jpg", landingPageUrl: "https://glow.example.com",
  spendEstimate: "Unknown", likes: 10, views: "1.0K", daysRunning: 20, aiScore: 50, firstSeenAt: "2026-08-01T00:00:00.000Z",
};
const adBase = {
  platform: "Facebook", country: "US", niche: "Pet Supplies", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};
const prefsBase = {
  watchedNiches: ["Pet Supplies"], notifyNewWinners: true, notifyNewAdsInNiches: true, notifyTrackedStoreUpdates: true,
  emailDigestEnabled: true, updatedAt: "2026-09-01T00:00:00Z",
};

describe("AdLibrary sync after an admin deletes an ad", () => {
  it("recreates the ad instead of failing", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.adlibrary.sync.upsertAd, { ...syncArgs, externalId: "k1" });
    const [ad] = await t.run((ctx) => ctx.db.query("ads").collect());
    await t.run((ctx) => ctx.db.delete("ads", ad._id));
    expect(await t.mutation(internal.adlibrary.sync.upsertAd, { ...syncArgs, externalId: "k1" })).toBe("created");
    expect(await t.run((ctx) => ctx.db.query("ads").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("adlibrarySyncedAds").collect())).toHaveLength(1);
  });
});

describe("work that used to stop at a fixed cap now reaches everyone", () => {
  it("daily follow alerts reach every follower across batches, once each", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T08:35:00Z"));
    const t = convexTest(schema, modules);
    // 7 advertisers × 20 followers = 140 follows: three batches of 50.
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    await t.run(async (ctx) => {
      for (let u = 0; u < 20; u++) {
        const userId = await ctx.db.insert("users", { tokenIdentifier: `u${u}`, role: "user" });
        for (const name of names) await ctx.db.insert("followedAdvertisers", { userId, name, followedAt: "2026-09-01T00:00:00Z" });
      }
    });
    await t.mutation(internal.follows.sendDailyAlerts, {}); // baseline run
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    vi.setSystemTime(new Date("2026-10-02T06:00:00Z"));
    await t.run(async (ctx) => {
      for (const name of names) await ctx.db.insert("ads", { ...adBase, advertiserName: name, headline: `New from ${name}` });
    });
    vi.setSystemTime(new Date("2026-10-02T08:35:00Z"));
    await t.mutation(internal.follows.sendDailyAlerts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes).toHaveLength(140);
    expect(new Set(notes.map((n) => `${n.userId}:${n.title}`)).size).toBe(140);
    const state = await t.run((ctx) => ctx.db.query("siteStats").withIndex("by_key", (q) => q.eq("key", "followAlerts")).unique());
    expect(state?.data).toMatchObject({ lastRunAt: new Date("2026-10-02T08:35:00Z").getTime() });
  });

  it("niche alerts and the email digest reach more than the old 2,000-user cap", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 2100; i++) {
        const userId: Id<"users"> = await ctx.db.insert("users", { tokenIdentifier: `u${i}`, role: "user", email: `u${i}@x.com` });
        await ctx.db.insert("alertPreferences", { ...prefsBase, userId });
      }
    });
    await t.mutation(internal.notifications.notifyUsersWatchingNiche, {
      niche: "Pet Supplies", title: "New ad", body: "b", link: "/x", type: "new_ad",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(2100);

    let cursor: string | null = null;
    let total = 0;
    for (let done = false; !done; ) {
      const page: { due: unknown[]; cursor: string; isDone: boolean } = await t.query(internal.digest.dueRecipients, {
        cursor,
        nowMs: Date.parse("2026-09-02T08:30:00Z"),
      });
      total += page.due.length;
      cursor = page.cursor;
      done = page.isDone;
    }
    expect(total).toBe(2100);
  });
});
