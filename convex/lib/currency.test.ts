import { describe, expect, it } from "vitest";
import { formatMoney, ratesFromEcbXml } from "./currency";
import { unitsPerMonthFromText } from "./estimates";
import { shopifyDescription, upgradeDescription } from "./productCopy";

const ECB = `<Cube time='2026-10-06'><Cube currency='USD' rate='1.1269'/><Cube currency='DKK' rate='7.4631'/><Cube currency='GBP' rate='0.8488'/></Cube>`;

describe("display currency", () => {
  it("turns the ECB's euro rates into dollar rates", () => {
    const r = ratesFromEcbXml(ECB)!;
    expect(r.USD).toBe(1);
    expect(r.EUR).toBeCloseTo(0.8874, 4);
    expect(r.DKK).toBeCloseTo(6.6227, 3);
    expect(r.GBP).toBeCloseTo(0.7532, 4);
    expect(ratesFromEcbXml("<html>maintenance</html>")).toBeNull();
  });

  it("shows prices with two decimals and large amounts compactly", () => {
    expect(formatMoney(118.8, "USD", 1)).toBe("$118.80");
    expect(formatMoney(20, "EUR", 0.9)).toBe("€18.00");
    expect(formatMoney(12_400, "USD", 1, { compact: true })).toBe("$12.4K");
    expect(formatMoney(523, "USD", 1, { compact: true })).toBe("$523");
    expect(formatMoney(100, "DKK", 6.6)).toMatch(/^DKK\s?660\.00$/);
  });
});

describe("product copy", () => {
  it("writes Shopify descriptions in plain English, keeping the order count readable for estimates", () => {
    const d = shopifyDescription(320, 5, 3);
    expect(d).toBe("Running Facebook ads as of last week (est.). 320 orders last week, 5 Facebook ads, sold by 3 stores.");
    expect(unitsPerMonthFromText(d)).toBe(1376);
    expect(shopifyDescription()).toBe("Running Facebook ads as of last week (est.).");
  });

  it("rewrites the old description and leaves others alone", () => {
    expect(upgradeDescription("Shopify store product running Facebook ads · 1,200 orders last week (est.) · 1 Facebook ad.")).toBe(
      "Running Facebook ads as of last week (est.). 1,200 orders last week, 1 Facebook ad.",
    );
    expect(upgradeDescription("Shopify store product running Facebook ads.")).toBe("Running Facebook ads as of last week (est.).");
    expect(upgradeDescription("A great lamp.")).toBe("A great lamp.");
  });
});
