/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { fromRdap, fromWhois, isoDay, registrableDomain, whoisServer } from "./lib/domainAge";
import { speedBand, speedRun } from "./lib/pageSpeed";
import { productVideos, recentViews, searchIds } from "./lib/youtube";
import { pickPhoto, placeholders, withPhotos } from "./lib/pexels";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("domain age", () => {
  it("finds the registrable domain and the right service", () => {
    expect(registrableDomain("www.shop.customlove.se")).toBe("customlove.se");
    expect(registrableDomain("shop.brand.co.uk")).toBe("brand.co.uk");
    expect(whoisServer("customlove.se")).toBe("whois.iis.se");
    expect(whoisServer("ekohemshop.dk")).toBe("whois.punktum.dk");
    expect(whoisServer("gymshark.com")).toBeNull(); // RDAP
    expect(["2023-10-28", "12-Jan-2015", "28.10.2023", "2011-09-16T00:05:31Z"].map(isoDay)).toEqual(["2023-10-28", "2015-01-12", "2023-10-28", "2011-09-16"]);
  });

  it("reads the date from the Swedish, Danish and Norwegian registries and from RDAP", () => {
    expect(fromWhois("# Copyright\nstate:            active\ndomain:           customlove.se\ncreated:          2023-10-28\nexpires:          2026-10-28\nregistrar:        1 Api GmbH\n", "customlove.se"))
      .toEqual({ domain: "customlove.se", registered: "2023-10-28", registrar: "1 Api GmbH", source: "whois" });
    expect(fromWhois("Domain:               ekohemshop.dk\nRegistered:           2026-03-23\nExpires:              2027-03-22\nRegistrar:            Realtime Register B.V.\n", "ekohemshop.dk"))
      .toMatchObject({ registered: "2026-03-23", registrar: "Realtime Register B.V." });
    expect(fromWhois("Domain Name................: vg.no\nRegistrar Handle...........: REG42-NORID\nCreated:         2011-06-10\n", "vg.no")).toEqual({ domain: "vg.no", registered: "2011-06-10", source: "whois" });
    expect(fromWhois("No match for domain", "x.se")).toBeNull();
    const rdap = {
      events: [{ eventAction: "registration", eventDate: "2011-09-16T00:05:31Z" }, { eventAction: "expiration", eventDate: "2028-09-16T00:05:31Z" }],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "MarkMonitor Inc."]]] }],
    };
    expect(fromRdap(rdap, "gymshark.com")).toEqual({ domain: "gymshark.com", registered: "2011-09-16", registrar: "MarkMonitor Inc.", source: "rdap" });
  });
});

describe("store speed", () => {
  const lighthouse = (score: number) => ({
    lighthouseResult: { categories: { performance: { score } }, audits: { "largest-contentful-paint": { numericValue: 4830 }, "first-contentful-paint": { numericValue: 1210 }, "cumulative-layout-shift": { numericValue: 0.0213 } } },
    loadingExperience: { overall_category: "AVERAGE" },
  });

  it("reads Lighthouse's score and timings", () => {
    expect(speedRun(lighthouse(0.42))).toEqual({ score: 42, lcp: 4.8, fcp: 1.2, cls: 0.021, realUsers: "AVERAGE" });
    expect(speedRun({})).toBeNull();
    expect([95, 70, 30].map(speedBand)).toEqual(["good", "ok", "poor"]);
  });

  it("tests a store on a phone and a desktop once a day", async () => {
    process.env.PAGESPEED_API_KEY = "ps-key";
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      return json(lighthouse(String(u).includes("strategy=mobile") ? 0.42 : 0.88));
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.storeSpeed.check, { host: "customlove.se" });
    expect(r).toMatchObject({ mobile: { score: 42 }, desktop: { score: 88 } });
    expect(asked[0]).toContain("url=https%3A%2F%2Fcustomlove.se%2F");
    await me.action(api.storeSpeed.check, { host: "customlove.se" });
    expect(asked).toHaveLength(2); // the second from the cache
  });
});

describe("YouTube", () => {
  const videos = {
    items: [
      { id: "a1", snippet: { title: "Dog Cooling Mat REVIEW &amp; test", channelTitle: "PetLab", publishedAt: "2026-09-01T00:00:00Z", thumbnails: { medium: { url: "https://i.ytimg.com/a1.jpg" } } }, statistics: { viewCount: "120000" } },
      { id: "b2", snippet: { title: "Unboxing", channelTitle: "X", publishedAt: "2024-01-01T00:00:00Z" }, statistics: { viewCount: "900000" } },
      { id: "c3", snippet: { title: "no views" }, statistics: {} },
    ],
  };

  it("adds up the views, most watched first", () => {
    expect(searchIds({ items: [{ id: { videoId: "a1" } }, { id: { channelId: "x" } }, { id: { videoId: "a1" } }] })).toEqual(["a1"]);
    const p = productVideos(videos, new Date("2026-10-16"));
    expect(p.totalViews).toBe(1_020_000);
    expect(p.videos.map((v) => v.id)).toEqual(["b2", "a1"]);
    expect(p.videos[1]).toMatchObject({ title: "Dog Cooling Mat REVIEW & test", thumbnail: "https://i.ytimg.com/a1.jpg" });
    expect(recentViews(p, Date.parse("2026-10-16"))).toBe(120_000);
  });

  it("looks a product up once and saves it for everyone", async () => {
    process.env.YOUTUBE_API_KEY = "yt-key";
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("products", {
        title: "Dog Cooling Mat for Summer", description: "", imageUrl: "i", category: "Pet Supplies", tags: [], aiScore: 80,
        saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
      });
    });
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      return String(u).includes("/search?") ? json({ items: [{ id: { videoId: "a1" } }, { id: { videoId: "b2" } }] }) : json(videos);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.action(api.youtube.productVideosFor, { productId })).toEqual({ found: 2 });
    expect(asked[0]).toContain("q=Dog+Cooling+Mat+for+Summer+review");
    expect(asked[1]).toContain("id=a1%2Cb2");
    expect((await t.run((ctx) => ctx.db.get("products", productId)))?.youtube).toMatchObject({ totalViews: 1_020_000 });
    expect(await me.action(api.youtube.productVideosFor, { productId })).toEqual({ skipped: "checked recently" });
  });
});

describe("Pexels photos", () => {
  const page = `<!DOCTYPE html><html><head><title>Pillow</title></head><body>${"<p>Soft.</p>".repeat(10)}
<img src="https://placehold.co/1200x600/EEEEEE/999999?text=Woman+sleeping+on+a+white+pillow">
<img src="https://placehold.co/400x400/EEEEEE/999999?text=Woman+sleeping+on+a+white+pillow">
<div style="background:url(https://placehold.co/1200x600/EEEEEE/999999?text=Woman+sleeping+on+a+white+pillow)"></div>
<img src="https://placehold.co/80x80"></body></html>`;

  it("finds the placeholders and swaps each for a different photo", () => {
    const found = placeholders(page);
    expect(found.map((p) => [p.width, p.height, p.query])).toEqual([[1200, 600, "Woman sleeping on white pillow"], [400, 400, "Woman sleeping on white pillow"]]); // no text: kept
    const result = { photos: [{ id: 1, url: "https://www.pexels.com/photo/1", photographer: "Ana", photographer_url: "https://www.pexels.com/@ana", src: { original: "https://images.pexels.com/photos/1/a.jpeg" } }, { id: 2, photographer: "Bo", src: { original: "https://images.pexels.com/photos/2/b.jpeg" } }] };
    const used = new Set<number>();
    const a = pickPhoto(result, found[0], used)!;
    const b = pickPhoto(result, found[1], used)!;
    expect(a.src).toBe("https://images.pexels.com/photos/1/a.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=2400&h=1200");
    expect(b.src).toContain("photos/2/"); // not the same photo twice
    expect(a.credit).toEqual({ photographer: "Ana", photographerUrl: "https://www.pexels.com/@ana", pexelsUrl: "https://www.pexels.com/photo/1" });
    const html = withPhotos(page, new Map([[found[0].url, a.src]]));
    expect(html.split(a.src)).toHaveLength(3); // the img and the background
    expect(html).toContain("https://placehold.co/400x400");
  });

  it("puts real photos in a page the AI built, with their credits", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.PEXELS_API_KEY = "px-key";
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin" }));
    let pexelsAuth: string | null = null;
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      if (String(u).startsWith("https://api.pexels.com/")) {
        pexelsAuth = new Headers(init?.headers).get("authorization");
        return json({ photos: [{ id: Math.round(Math.random() * 1e9), url: "https://www.pexels.com/photo/9", photographer: "Ana", photographer_url: "https://www.pexels.com/@ana", src: { original: "https://images.pexels.com/photos/9/x.jpeg" } }] });
      }
      return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: page }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const { id } = await me.action(api.screenPagesAi.create, { images: [{ data: Buffer.from("x").toString("base64"), mediaType: "image/jpeg" }] });
    await settle(t);
    const saved = await me.query(api.screenPages.get, { id });
    expect(pexelsAuth).toBe("px-key");
    expect(saved?.html).not.toContain("placehold.co/1200x600");
    expect(saved?.html).toContain("images.pexels.com/photos/9/x.jpeg");
    expect(saved?.photoCredits).toEqual([{ photographer: "Ana", photographerUrl: "https://www.pexels.com/@ana", pexelsUrl: "https://www.pexels.com/photo/9" }]);
  });
});
