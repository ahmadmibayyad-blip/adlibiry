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

import { classifyNiche, guessCategory } from "./category";

describe("classifyNiche", () => {
  it("files products by what they are, not by the first loose keyword", () => {
    expect(classifyNiche({ title: "LED dog collar for night walks" })).toBe("Pet Supplies"); // was Fashion (collar) / Electronics (LED)
    expect(classifyNiche({ title: "Baby stroller with car seat" })).toBe("Baby & Kids"); // was Home (car)
    expect(classifyNiche({ title: "Gold plated necklace with pendant" })).toBe("Jewelry");
    expect(classifyNiche({ title: "Hand-poured soy candles" })).toBe("Home & Living");
    expect(classifyNiche({ title: "Magnetic car phone mount" })).toBe("Automotive");
    expect(classifyNiche({ title: "Posture corrector for back pain" })).toBe("Health & Wellness");
  });

  it("reads the product URL slug and Nordic/German copy", () => {
    expect(classifyNiche({ title: "Only today — 50% off!", url: "https://shop.dk/products/no-pull-dog-harness" })).toBe("Pet Supplies");
    expect(classifyNiche({ title: "Smukke smykker til hende", body: "Halskæde i ægte sølv" })).toBe("Jewelry");
    expect(classifyNiche({ title: "Legetøj til børn" })).toBe("Toys");
    expect(classifyNiche({ title: "Sko til børn" })).toBe("Fashion");
    expect(classifyNiche({ title: "Ergonomische Kopfhörer mit Ladegerät" })).toBe("Electronics");
  });

  it("does not treat Swedish 'bra' (= good) as a bra", () => {
    expect(classifyNiche({ title: "Så bra för din hund" })).toBe("Pet Supplies");
    expect(classifyNiche({ title: "Riktigt bra erbjudande" }, "Beauty")).toBe("Beauty");
  });

  it("keeps the fallback when the evidence is unclear", () => {
    expect(classifyNiche({ title: "Only today — 50% off everything!" }, "Fashion")).toBe("Fashion");
    expect(classifyNiche({ title: "Limited offer" })).toBe("Other");
    expect(guessCategory("Wireless earbuds with charging case")).toBe("Electronics");
  });
});

import { findPayload, nestedError, describeReply } from "./nexscopeReply";

describe("Nexscope reply parsing", () => {
  const items = [{ id: "1" }];
  it("finds the payload with or without the platform envelope", () => {
    expect(findPayload({ errcode: 200, data: { items, total_count: 1 } }, "items")?.items).toEqual(items); // documented
    expect(findPayload({ code: 0, msg: "ok", data: { errcode: 200, data: { items } } }, "items")?.items).toEqual(items); // enveloped
    expect(findPayload({ total: 1, stores: [{ storeId: "s" }] }, "stores")?.stores).toHaveLength(1);
    expect(findPayload({ code: 0, data: { total: 1, stores: [{ storeId: "s" }] } }, "stores")?.stores).toHaveLength(1);
    expect(findPayload({ code: 0, data: null }, "items")).toBeUndefined();
  });
  it("surfaces provider errors at any level", () => {
    expect(nestedError({ code: 0, data: { errcode: 200, data: {} } })).toBeUndefined();
    expect(nestedError({ code: 0, data: { errcode: 401, errmsg: "no credits" } })).toBe("no credits");
    expect(nestedError({ code: 1003, msg: "Insufficient credits" })).toBe("Insufficient credits");
  });
  it("describes an empty reply's shape", () => {
    expect(describeReply({ code: 0, msg: "ok", data: { list: [] } })).toBe('reply {code, msg, data} · message "ok" · data {list}');
  });
});

import { pipiRowToAd } from "./pipispyTransform";

describe("pipiRowToAd", () => {
  // Shape from PiPiSpy's AdSpy List docs (response example).
  const row = {
    video_id: "d9055376ae19819f4756",
    platform: 3, // response: 3 = TikTok
    type: 1,
    desc: "No-pull dog harness that stops pulling in 2 walks #dog #pets",
    cover: "https://cdn-video.pipispy.com/cover.jpg",
    video_url: "https://cdn-video.pipispy.com/video.mp4",
    app_name: "Nordic Pets",
    app_image: "https://cdn-video.pipispy.com/avatar.jpg",
    button_text: "Shop now",
    play_count: 47527,
    digg_count: 318,
    comment_count: 2,
    share_count: 32,
    put_days: 12,
    found_time: 1749614161,
    last_put_time: 1752204344,
    fetch_region: ["US", "DK"],
    min_cpm: 33.74,
    ai_analysis_language: "en",
    ai_analysis_tags: ["#dogharness", "#pets"],
  };
  it("maps a documented row", () => {
    const ad = pipiRowToAd(row, { preferCountries: ["DK"], nowMs: 1752204344_000 + 3600_000 });
    expect(ad).toMatchObject({
      externalId: "pipi:d9055376ae19819f4756",
      source: "pipispy",
      platform: "TikTok",
      country: "DK", // the market asked for, not the first listed
      countries: ["US", "DK"],
      niche: "Pet Supplies",
      advertiserName: "Nordic Pets",
      ctaText: "Shop now",
      impressions: 47527,
      views: "47.5K",
      likes: 318,
      comments: 2,
      shares: 32,
      daysRunning: 12,
      mediaType: "video",
      videoUrl: "https://cdn-video.pipispy.com/video.mp4",
      spendEstimate: "$34+ (PiPiSpy est.)",
      firstSeenAt: new Date(1749614161_000).toISOString(),
      isActive: true,
      language: "en",
    });
  });
  it("maps response platform codes (1=Facebook, 2=Instagram) and skips empty rows", () => {
    expect(pipiRowToAd({ ...row, platform: 1 })?.platform).toBe("Facebook");
    expect(pipiRowToAd({ ...row, platform: 2 })?.platform).toBe("Instagram");
    expect(pipiRowToAd({ platform: 1 })).toBeNull();
    expect(pipiRowToAd({ video_id: "x" })).toBeNull();
  });
});
