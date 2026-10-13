import { describe, expect, it } from "vitest";
import { autoMap, buildRows, moneyToUsd, parseCsv } from "./productCsv";

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

  it("converts prices and GMV in other currencies to USD (a Rp 78,495 oil isn't a $78,495 product)", () => {
    const csv =
      '"Products","Product Image URL","TikTok URL","Product Price","Total GMV"\n' +
      '"FYC Hair Story Ginseng Hair Essence Oil","https://p16.ttcdn.com/oil.webp","https://shop-id.tokopedia.com/pdp/1","Rp78.495","Rp6.151.234.567"\n' +
      '"Áo thun","https://p16.ttcdn.com/a.webp","https://vt.tiktok.com/2","129.000₫","₫1.2M"\n' +
      '"Lamp","https://x/l.png","https://shop.dk/products/l","€24,95","$1,000"\n' +
      '"Mat","https://x/m.png","https://shop.dk/products/m","INR13999.0",""\n' +
      '"Ring","https://x/r.png","https://shop.dk/products/r","149 kr",""\n' +
      '"Mug","https://x/u.png","https://shop.dk/products/u","XYZ12",""\n';
    const table = parseCsv(csv);
    const rows = buildRows(table, autoMap(table[0]), { category: "auto" }).rows;
    expect(rows.map((r) => r.priceUsd)).toEqual([4.82, 5.08, 26.95, 166.65, undefined, undefined]);
    expect(rows.map((r) => r.totalGmv)).toEqual([377376.35, 47.24, 1000, undefined, undefined, undefined]);
    expect(moneyToUsd("Rp78,495.01")).toBe(4.82);
    expect(moneyToUsd("78495", "Price (IDR)")).toBe(4.82);
    expect(moneyToUsd("$8.24")).toBe(8.24);
    expect(moneyToUsd("฿299")).toBe(8.93);
  });

  it("prefers the 30-day column over the 7-day one", () => {
    const table = parseCsv("Title,Image,Items Sold (Last 7 days),Items Sold (Last 30 days)\nLamp,https://x/l.png,10,100\n");
    expect(buildRows(table, autoMap(table[0]), { category: "auto" }).rows[0].unitsPerMonth).toBe(100);
  });
});
