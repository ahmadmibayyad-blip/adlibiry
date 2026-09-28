import { describe, expect, it } from "vitest";
import { toAlpha2, toAlpha2List } from "./countryCodes";
import { parseExtensionAd, scoreFromSignals, daysSince } from "./extensionSubmission";
import { whToRecords } from "./whTransform";

describe("toAlpha2", () => {
  it("accepts alpha-2, alpha-3 and English names", () => {
    expect(toAlpha2("dk")).toBe("DK");
    expect(toAlpha2("DNK")).toBe("DK");
    expect(toAlpha2("Denmark")).toBe("DK");
    expect(toAlpha2("United Kingdom")).toBe("GB");
    expect(toAlpha2("UK")).toBe("GB");
  });
  it("never guesses from a name prefix", () => {
    // The old Apify mapping did name.slice(0, 2): Germany → "GE", Sweden → "SW".
    expect(toAlpha2("Germany")).toBe("DE");
    expect(toAlpha2("Sweden")).toBe("SE");
    expect(toAlpha2("Atlantis")).toBeUndefined();
    expect(toAlpha2("")).toBeUndefined();
    expect(toAlpha2(42)).toBeUndefined();
  });
  it("dedupes lists and drops unknowns", () => {
    expect(toAlpha2List(["DK", "Denmark", "SWE", "Nowhere", null])).toEqual(["DK", "SE"]);
    expect(toAlpha2List("DK")).toEqual([]);
  });
});

describe("parseExtensionAd", () => {
  const base = { visitorId: "v1", advertiserName: "Glow Co", platform: "Facebook", bodyText: "Best lamp ever" };

  it("requires identity fields", () => {
    expect(parseExtensionAd({ ...base, visitorId: "" })).toEqual({ ok: false, error: "Missing or invalid field: visitorId" });
    expect(parseExtensionAd({ visitorId: "v", advertiserName: "A", platform: "Facebook" })).toEqual({ ok: false, error: "Ad has no creative or text" });
  });

  it("keeps the rich fields the extension scraped", () => {
    const r = parseExtensionAd({
      ...base,
      adKey: "Facebook:123",
      adArchiveId: "123456",
      adLibraryUrl: "https://www.facebook.com/ads/library/?id=123456",
      ctaText: "Shop now",
      videos: [{ poster: "https://x/p.jpg" }, { hd: "https://video.fbcdn.net/v.mp4" }],
      mediaType: "video",
      reactions: 1200,
      comments: 45,
      shares: 7,
      countries: ["DK", "Sweden"],
      isActive: true,
      startDate: "2026-09-01T00:00:00Z",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submission).toMatchObject({
      adKey: "meta_123456", // same key the Apify importer uses → one row per Meta ad
      videoUrl: "https://video.fbcdn.net/v.mp4",
      ctaText: "Shop now",
      mediaType: "video",
      likes: 1200,
      comments: 45,
      shares: 7,
      countries: ["DK", "SE"],
      isActive: true,
      startedAt: "2026-09-01T00:00:00.000Z",
      headline: "Best lamp ever",
    });
  });

  it("uses the extension key when there's no Ad Library id, and rejects junk values", () => {
    const r = parseExtensionAd({
      ...base,
      adKey: "h:abc",
      videoUrl: "https://www.tiktok.com/@x/video/1", // a page, not playable media
      likes: -5,
      comments: "12",
      mediaType: "hologram",
      startDate: "2999-01-01",
      advertiserAvatar: "javascript:alert(1)",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submission.adKey).toBe("ext:h:abc");
    expect(r.submission.videoUrl).toBeUndefined();
    expect(r.submission.likes).toBeUndefined();
    expect(r.submission.comments).toBeUndefined();
    expect(r.submission.mediaType).toBeUndefined();
    expect(r.submission.startedAt).toBeUndefined();
    expect(r.submission.advertiserAvatar).toBeUndefined();
    expect("countries" in r.submission).toBe(false);
  });
});

describe("scoreFromSignals / daysSince", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  it("scores from real signals only", () => {
    expect(scoreFromSignals({}, now)).toBe(1);
    const low = scoreFromSignals({ startedAt: "2026-09-25T00:00:00Z", likes: 3 }, now);
    const high = scoreFromSignals({ startedAt: "2026-07-01T00:00:00Z", likes: 50_000, comments: 2_000, shares: 900, impressions: 5_000_000 }, now);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });
  it("counts days running", () => {
    expect(daysSince(undefined, now)).toBe(0);
    expect(daysSince("2026-09-18T00:00:00Z", now)).toBe(10);
  });
});

describe("whToRecords", () => {
  const row = {
    id: "999",
    pageName: "Nordic Pets",
    copy: "Dog harness that never pulls",
    poster: "https://cdn.example.com/p.jpg",
    countries: ["US", "DK", "SE"],
    started: "2026-09-01T00:00:00Z",
    lastSeen: "2026-09-27T00:00:00Z",
  };
  it("prefers the market the import asked for as the ad's country", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    expect(whToRecords([row], now).ads[0].country).toBe("US");
    expect(whToRecords([row], now, ["DK"]).ads[0].country).toBe("DK");
    expect(whToRecords([row], now, ["NO"]).ads[0].country).toBe("US"); // not in the ad's list → fallback
  });
});
