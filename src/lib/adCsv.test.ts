import { describe, expect, it } from "vitest";
import { AD_TEMPLATE_CSV, autoMapAds, buildAdRows, parseCsv } from "./adCsv";

const now = new Date("2026-09-30T00:00:00Z");
const opts = { niche: "auto", platform: "Facebook", country: "US", now };

describe("ad CSV import", () => {
  it("maps and builds the template row", () => {
    const table = parseCsv(AD_TEMPLATE_CSV);
    const map = autoMapAds(table[0]);
    const { rows, invalid } = buildAdRows(table, map, opts);
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(1);
    const ad = rows[0];
    expect(ad.externalId).toBe("csv:facebook:123456789");
    expect(ad.source).toBe("csv_import");
    expect(ad.advertiserName).toBe("Paws & Co");
    expect(ad.niche).toBe("Pet Supplies");
    expect(ad.mediaType).toBe("video");
    expect(ad.videoUrl).toBe("https://example.com/mat.mp4");
    expect(ad.likes).toBe(15400);
    expect(ad.views).toBe("1.2M");
    expect(ad.spendEstimate).toBe("$5.0K");
    expect(ad.daysRunning).toBe(60);
    expect(ad.firstSeenAt).toBe(now.toISOString());
    expect(ad.lastSeenAt).toBe(now.toISOString());
    expect(ad.aiScore).toBeGreaterThan(0);
    expect(ad.aiScore).toBeLessThanOrEqual(100);
  });

  it("skips rows without media, dedupes, and applies defaults", () => {
    const csv =
      "Page Name;Ad Text;Thumbnail;Platform;Country\n" +
      "Shop A;Great serum for glowing skin;https://x.com/a.jpg;instagram;United Kingdom, DE\n" +
      "Shop A;Great serum for glowing skin;https://x.com/a.jpg;instagram;GB\n" +
      "Shop B;No image here;;;\n" +
      "Shop C;Hello;https://x.com/c.jpg;;\n";
    const table = parseCsv(csv);
    const { rows, duplicates, invalid } = buildAdRows(table, autoMapAds(table[0]), opts);
    expect(invalid).toBe(1);
    expect(duplicates).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].platform).toBe("Instagram");
    expect(rows[0].countries).toEqual(["GB", "DE"]);
    expect(rows[0].country).toBe("GB");
    expect(rows[1].platform).toBe("Facebook");
    expect(rows[1].country).toBe("US");
    expect(rows[1].headline).toBe("Hello");
  });

  it("reads TikTok Shop product-finder exports", () => {
    const csv =
      '"TikTok URL","Products","Product Image URL","Product Price","Product Category","Shop","Brand","Items Sold (Last 7 days)","Estimated Listed Date"\n' +
      '"https://www.tiktok.com/shop/pdp/1732088493046665521?source=anchor","H&M Trainers","https://p16-oec-general.ttcdn-us.com/tos/b704~tplv-fhlh96nyum-crop-webp:800:800.webp?dr=1","$51.99","Shoes","H&M US","-",1,"2026-09-02"\n';
    const table = parseCsv(csv);
    const map = autoMapAds(table[0], table.slice(1));
    expect(map.creativeUrl).toBe(2);
    const { rows, invalid } = buildAdRows(table, map, opts);
    expect(invalid).toBe(0);
    expect(rows[0].advertiserName).toBe("H&M US");
    expect(rows[0].headline).toBe("H&M Trainers");
    expect(rows[0].platform).toBe("TikTok");
    expect(rows[0].landingPageUrl).toContain("tiktok.com/shop/pdp/");
    expect(rows[0].bodyText).toContain("Product Price: $51.99");
    expect(rows[0].bodyText).not.toContain("Brand");
    expect(rows[0].daysRunning).toBe(28);
  });

  it("finds an image column by its values when the header gives no hint", () => {
    const csv = "Name,Asset\nCool lamp,https://cdn.example.com/files/lamp.png\n";
    const table = parseCsv(csv);
    expect(autoMapAds(table[0], table.slice(1)).creativeUrl).toBe(1);
  });
});
