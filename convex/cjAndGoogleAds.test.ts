/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { cjMatches, cjProducts, cjShippingOptions, cjVariant } from "./lib/cj";
import { adRun, googleAds } from "./lib/googleAds";

const modules = import.meta.glob("./**/*.ts");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cjList = {
  code: 200, result: true,
  data: { pageSize: 20, pageNumber: 1, totalRecords: 2, content: [{ productList: [
    { id: "1650301", nameEn: "Pet Dog Cooling Mat Summer Ice Pad", sellPrice: "4.20 -- 6.80", bigImage: "https://cf.cjdropshipping.com/a.jpg", listedNum: 812, warehouseInventoryNum: 3400 },
    { id: "1650302", nameEn: "Dog Cooling Mat Large Breathable", nowPrice: "5.10", sellPrice: "6.00", listedNum: 90 },
    { id: "999", nameEn: "Phone Case iPhone 15", sellPrice: "1.10" },
  ] }] },
};
const cjQuery = { result: true, data: { variants: [{ vid: "V1", inventories: [{ countryCode: "CN", totalInventory: 3000 }, { countryCode: "US", totalInventory: 0 }, { countryCode: "DE", totalInventory: 40 }] }] } };
const cjFreight = { result: true, data: [
  { logisticName: "CJPacket Ordinary", logisticPrice: 3.4, logisticAging: "10-20" },
  { logisticName: "YunExpress", logisticPrice: 5.1, logisticAging: "6-9" },
  { logisticName: "DHL", logisticPrice: 21.0, logisticAging: "3-5" },
] };

afterEach(() => vi.unstubAllGlobals());

describe("CJ Dropshipping", () => {
  it("reads CJ's products, matches them by title and picks shipping", () => {
    const products = cjProducts(cjList);
    expect(products[0]).toEqual({ pid: "1650301", title: "Pet Dog Cooling Mat Summer Ice Pad", price: 4.2, url: "https://cjdropshipping.com/product/pet-dog-cooling-mat-summer-ice-pad-p-1650301.html", imageUrl: "https://cf.cjdropshipping.com/a.jpg", listed: 812, inventory: 3400 });
    expect(products[1].price).toBe(5.1); // the discount price
    const matches = cjMatches("Dog Cooling Mat", products);
    expect(matches.map((m) => m.pid)).toEqual(["1650301", "1650302"]); // the phone case doesn't match
    expect(cjVariant(cjQuery)).toEqual({ vid: "V1", stockIn: ["CN", "DE"] });
    expect(cjShippingOptions(cjFreight)).toEqual({
      cheapest: { method: "CJPacket Ordinary", priceUsd: 3.4, days: "10-20" },
      fastest: { method: "DHL", priceUsd: 21, days: "3-5" },
    });
  });

  it("finds CJ suppliers once with a cached token, and prices shipping from a warehouse in the country", async () => {
    process.env.CJ_API_KEY = "cj-key";
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      return ctx.db.insert("products", {
        title: "Dog Cooling Mat for Summer", description: "", imageUrl: "i", category: "Pet Supplies", tags: [], aiScore: 80,
        saturation: "Unknown", trend: "Unknown", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00.000Z",
      });
    });
    const calls: { url: string; body?: unknown; token?: string | null }[] = [];
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}), token: new Headers(init?.headers).get("CJ-Access-Token") });
      if (url.endsWith("/authentication/getAccessToken")) {
        return json({ result: true, data: { accessToken: "AT", accessTokenExpiryDate: "2027-04-01T00:00:00+08:00", refreshToken: "RT", refreshTokenExpiryDate: "2027-04-01T00:00:00+08:00" } });
      }
      if (url.includes("/product/listV2")) return json(cjList);
      if (url.includes("/product/query")) return json(cjQuery);
      if (url.endsWith("/logistic/freightCalculate")) return json(cjFreight);
      return json({}, 404);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.action(api.cj.findSuppliers, { productId })).toEqual({ found: 2 });
    expect(calls[0].body).toEqual({ apiKey: "cj-key" });
    expect(calls[1].url).toContain("keyWord=Dog+Cooling+Mat+for+Summer");
    expect(calls[1].token).toBe("AT");
    const saved = await t.run((ctx) => ctx.db.get("products", productId));
    expect(saved?.cjMatches?.map((m) => m.pid)).toEqual(["1650301", "1650302"]);
    expect(await me.action(api.cj.findSuppliers, { productId })).toEqual({ skipped: "already has CJ suppliers" });

    calls.length = 0;
    const ship = await me.action(api.cj.shipping, { pid: "1650301", country: "DE" });
    expect(ship).toMatchObject({ from: "DE", cheapest: { priceUsd: 3.4 } }); // CJ has stock in its German warehouse
    expect(calls.map((c) => c.url.split("/v1")[1].split("?")[0])).toEqual(["/product/query", "/logistic/freightCalculate"]); // the token was reused
    expect(calls[1].body).toEqual({ startCountryCode: "DE", endCountryCode: "DE", products: [{ quantity: 1, vid: "V1" }] });
    calls.length = 0;
    expect(await me.action(api.cj.shipping, { pid: "1650301", country: "DE" })).toMatchObject({ from: "DE" });
    expect(calls).toHaveLength(0); // from the cache
    expect(await me.action(api.cj.shipping, { pid: "1650301", country: "SE" })).toMatchObject({ from: "CN" });
  });
});

describe("Google & YouTube ads", () => {
  const answer = {
    success: true, credits_charged: 25, number_of_ads_estimate: 340, cursor: "x",
    ads: [
      { advertiserId: "AR1", creativeId: "CR1", format: "video", adUrl: "https://adstransparency.google.com/advertiser/AR1/creative/CR1", advertiserName: "Customlove AB", imageUrl: null, firstShown: "2026-08-01T10:00:00.000Z", lastShown: "2026-10-15T10:00:00.000Z" },
      { advertiserId: "AR1", creativeId: "CR2", format: "image", advertiserName: "Customlove AB", imageUrl: "https://tpc.googlesyndication.com/archive/simgad/1", firstShown: "2025-01-01T00:00:00.000Z", lastShown: "2025-03-01T00:00:00.000Z" },
      { creativeId: "broken" },
    ],
  };

  it("reads the store's ads, newest first", () => {
    const r = googleAds(answer)!;
    expect(r.estimate).toBe(340);
    expect(r.ads.map((a) => a.creativeId)).toEqual(["CR1", "CR2"]);
    expect(r.ads[1]).toMatchObject({ format: "image", imageUrl: "https://tpc.googlesyndication.com/archive/simgad/1", url: "https://adstransparency.google.com/advertiser/AR1/creative/CR2" });
    expect(adRun(r.ads[0], Date.parse("2026-10-16T10:00:00Z"))).toEqual({ days: 75, active: true });
    expect(adRun(r.ads[1], Date.parse("2026-10-16T10:00:00Z")).active).toBe(false);
    expect(googleAds({ success: false })).toBeNull();
  });

  it("looks a store up once a day for everyone and limits free accounts", async () => {
    process.env.SCRAPECREATORS_API_KEY = "sc-key";
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
    });
    const asked: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      asked.push({ url: String(u), key: new Headers(init?.headers).get("x-api-key") });
      return json(answer);
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.googleAds.forStore, { host: "https://www.customlove.se/products/x" });
    expect(r).toMatchObject({ estimate: 340, cached: false });
    expect(asked[0]).toEqual({ url: "https://api.scrapecreators.com/v1/google/company/ads?domain=customlove.se&get_ad_details=true", key: "sc-key" });
    // Someone else, same store: from the cache.
    expect(await t.withIdentity({ subject: "u2|s" }).action(api.googleAds.forStore, { host: "customlove.se" })).toMatchObject({ cached: true });
    await me.action(api.googleAds.forStore, { host: "customlove.se", platform: "youtube" });
    expect(asked[1].url).toContain("platform=youtube");
    await expect(me.action(api.googleAds.forStore, { host: "other.se" })).rejects.toThrow(/Upgrade to Pro/);
  });
});
