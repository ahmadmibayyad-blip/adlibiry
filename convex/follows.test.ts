/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const adBase = {
  platform: "Facebook", country: "US", niche: "Pet Supplies", bodyText: "", creativeUrl: "", landingPageUrl: "",
  spendEstimate: "", likes: 0, views: "0", daysRunning: 1, aiScore: 50, targeting: { ageRange: "", gender: "All", interests: [] },
  firstSeenAt: "2026-10-01T00:00:00.000Z", source: "curated",
};

afterEach(() => vi.useRealTimers());

describe("follow alerts", () => {
  it("follows and unfollows an advertiser", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    await expect(t.mutation(api.follows.toggleFollow, { name: "PawCo" })).rejects.toThrow(/sign in/);
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.mutation(api.follows.toggleFollow, { name: "PawCo" })).toEqual({ following: true });
    expect(await me.query(api.follows.isFollowing, { name: "PawCo" })).toBe(true);
    expect(await me.query(api.follows.listFollowing, {})).toMatchObject([{ name: "PawCo", adCount: 0 }]);
    expect(await me.mutation(api.follows.toggleFollow, { name: "PawCo" })).toEqual({ following: false });
    expect(await me.query(api.follows.listFollowing, {})).toEqual([]);
  });

  it("alerts followers once about new ads, and respects the preference", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T08:35:00Z"));
    const [u1, u2] = await t.run(async (ctx) => {
      const a = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const b = await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      for (const userId of [a, b]) await ctx.db.insert("followedAdvertisers", { userId, name: "PawCo", followedAt: "2026-09-01T00:00:00Z" });
      await ctx.db.insert("alertPreferences", {
        userId: b, watchedNiches: [], notifyNewWinners: true, notifyNewAdsInNiches: true, notifyTrackedStoreUpdates: true,
        notifyFollowedAdvertisers: false, emailDigestEnabled: false, updatedAt: "2026-09-01T00:00:00Z",
      });
      return [a, b];
    });
    await t.mutation(internal.follows.sendDailyAlerts, {}); // first run: sets the baseline

    vi.setSystemTime(new Date("2026-10-02T06:00:00Z"));
    const newest = await t.run(async (ctx) => {
      await ctx.db.insert("ads", { ...adBase, advertiserName: "PawCo", headline: "Old-style mat" });
      await ctx.db.insert("ads", { ...adBase, advertiserName: "OtherCo", headline: "Not followed" });
      return ctx.db.insert("ads", { ...adBase, advertiserName: "PawCo", headline: "Cooling mat for dogs" });
    });
    vi.setSystemTime(new Date("2026-10-02T08:35:00Z"));
    expect(await t.mutation(internal.follows.sendDailyAlerts, {})).toEqual({ alerts: 1 });

    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      userId: u1, type: "advertiser_ads", title: "PawCo launched 2 new ads", body: "Newest: “Cooling mat for dogs”", link: `/dashboard/ads/${newest}`,
    });
    expect(notes.some((n) => n.userId === u2)).toBe(false);

    // Nothing new since the last run → no more alerts.
    vi.setSystemTime(new Date("2026-10-03T08:35:00Z"));
    expect(await t.mutation(internal.follows.sendDailyAlerts, {})).toEqual({ alerts: 0 });
  });

  it("lists more ads from the same advertiser", async () => {
    const t = convexTest(schema, modules);
    const [a1] = await t.run(async (ctx) => [
      await ctx.db.insert("ads", { ...adBase, advertiserName: "PawCo", headline: "One" }),
      await ctx.db.insert("ads", { ...adBase, advertiserName: "PawCo", headline: "Two" }),
      await ctx.db.insert("ads", { ...adBase, advertiserName: "OtherCo", headline: "Three" }),
    ]);
    const more = await t.withIdentity({ subject: "test|s" }).query(api.follows.advertiserAds, { name: "PawCo", excludeId: a1 });
    expect(more.map((a) => a.headline)).toEqual(["Two"]);
  });
});
