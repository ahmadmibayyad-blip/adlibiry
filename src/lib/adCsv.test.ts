import { describe, expect, it } from "vitest";
import { AD_TEMPLATE_CSV, autoMapAds, buildAdRows, isProductExport, lacksNumbers, metaScore, parseCsv } from "./adCsv";

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

  it("reads ScrapeKit ad exports: numbers, media, advertiser and the ad's first line as headline", () => {
    const csv =
      "file_number,title,advertiser,ad_text,link,image,video,logo,platform,impressions,likes,comments,shares,days_running,spend,library_id,started,status,card_text\n" +
      '0001,Axel 123 limited,Axel 123 limited,"15% Off Your First order",https://axel123.com/,https://cdn.x.com/1.jpg,https://cdn.x.com/1.mp4,https://cdn.x.com/a.jpg,TikTok,1.0K,230,12,4,1,,,,Active,"Axel 123 limited 1 days TikTok 1d 30% 1.0K impressions"\n' +
      '0002,Axzenia,Axzenia,"Suffering from scoliosis? Our Instant Posture Corrector has you covered!",https://www.facebook.com/61551740572920/,https://cdn.x.com/2.jpg,,,,,,,,,,2275498076149743,"Oct 31, 2024",Active,"Active Library ID: 2275498076149743"\n';
    const table = parseCsv(csv);
    const map = autoMapAds(table[0]);
    expect(lacksNumbers(map)).toBe(false);
    const { rows, invalid } = buildAdRows(table, map, opts);
    expect(invalid).toBe(0);
    expect(rows[0]).toMatchObject({
      advertiserName: "Axel 123 limited",
      headline: "15% Off Your First order",
      bodyText: "15% Off Your First order",
      platform: "TikTok",
      views: "1.0K",
      impressions: 1000,
      likes: 230,
      comments: 12,
      shares: 4,
      daysRunning: 1,
      creativeUrl: "https://cdn.x.com/1.jpg",
      videoUrl: "https://cdn.x.com/1.mp4",
      mediaType: "video",
    });
    expect(rows[1]).toMatchObject({ advertiserName: "Axzenia", headline: "Suffering from scoliosis? Our Instant Posture Corrector has you covered!", externalId: "csv:facebook:2275498076149743" });
    expect(rows[1].daysRunning).toBeGreaterThan(300); // from "Started running on Oct 31, 2024"
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
    // …and the dialog stops it: it's a product list with no engagement columns.
    expect(isProductExport(table[0], map)).toBe(true);
  });

  it("scores Meta Ad Library rows on days running and ad copies", () => {
    const csv =
      "ad_id,advertiser,page_likes,start_date,days_running,ad_variations,headline,ad_text,cta,landing_url,ad_library_url,image_url\n" +
      "907487392096359,The Farmer's Dog,249552,2026-03-26,191,4,Sign up now,Dog food should be food,Shop now,https://www.thefarmersdog.com/ad50fb,https://www.facebook.com/ads/library/?id=907487392096359,https://scontent.xx.fbcdn.net/v/t39/1.jpg\n";
    const table = parseCsv(csv);
    const map = autoMapAds(table[0], table.slice(1));
    expect(map.likes).toBeUndefined(); // page likes are followers, not ad likes
    expect(lacksNumbers(map)).toBe(false);
    const ad = buildAdRows(table, map, opts).rows[0];
    expect(ad).toMatchObject({ daysRunning: 191, relatedAdsCount: 4, likes: 0, aiScore: metaScore(191, 4) });
    expect(ad.aiScore).toBe(68);
  });

  it("flags files with no numbers at all", () => {
    const header = ["Advertiser", "Image", "Headline", "Landing page"];
    expect(lacksNumbers(autoMapAds(header))).toBe(true);
  });

  it("doesn't flag ad exports as product exports", () => {
    const table = parseCsv(AD_TEMPLATE_CSV);
    expect(isProductExport(table[0], autoMapAds(table[0]))).toBe(false);
    // A GMV column alongside real engagement is still an ad export.
    const header = ["Video Cover", "Title", "Likes", "Views", "GMV"];
    expect(isProductExport(header, autoMapAds(header))).toBe(false);
  });

  it("finds an image column by its values when the header gives no hint", () => {
    const csv = "Name,Asset\nCool lamp,https://cdn.example.com/files/lamp.png\n";
    const table = parseCsv(csv);
    expect(autoMapAds(table[0], table.slice(1)).creativeUrl).toBe(1);
  });
});
