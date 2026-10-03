import { describe, expect, it } from "vitest";
import { autoMap, buildRows, parseCsv } from "./productCsv";

describe("product CSV import", () => {
  it("reads sales columns from TikTok Shop product exports", () => {
    const csv =
      '"Products","Product Image URL","TikTok URL","Product Price","Product Rating","Product Reviews","Items Sold (Last 7 days)","GMV (Last 7 days)","Total GMV"\n' +
      '"Truck Floor Mats","https://p16.ttcdn-us.com/mat.webp","https://www.tiktok.com/shop/pdp/1731521490546168636","$76.48","4.3","25","7","$616.93","$22,477.40"\n' +
      '"Car Trash Can","https://p16.ttcdn-us.com/can.webp","https://www.tiktok.com/shop/pdp/1729537238264418608","$8.24","4.5","27","-","$74.75","$8,149.36"\n';
    const table = parseCsv(csv);
    const { rows, invalid } = buildRows(table, autoMap(table[0]), { category: "auto" });
    expect(invalid).toBe(0);
    expect(rows[0]).toMatchObject({ title: "Truck Floor Mats", priceUsd: 76.48, unitsPerMonth: 30, totalGmv: 22477.4, rating: 4.3, reviews: 25 });
    // No items-sold value: a month of GMV ÷ price (74.75 × 30/7 ÷ 8.24 ≈ 39).
    expect(rows[1].unitsPerMonth).toBe(39);
  });

  it("prefers the 30-day column over the 7-day one", () => {
    const table = parseCsv("Title,Image,Items Sold (Last 7 days),Items Sold (Last 30 days)\nLamp,https://x/l.png,10,100\n");
    expect(buildRows(table, autoMap(table[0]), { category: "auto" }).rows[0].unitsPerMonth).toBe(100);
  });
});
