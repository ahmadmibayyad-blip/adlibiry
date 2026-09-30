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
    expect(ad.firstSeenAt).toBe("2026-08-01T00:00:00.000Z");
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
});
