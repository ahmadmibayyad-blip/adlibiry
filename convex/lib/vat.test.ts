import { describe, expect, it } from "vitest";
import { marginMath } from "./researchReport";
import { vatRate, withVat } from "./vat";

describe("VAT rates", () => {
  it("looks up a country's VAT rate, ignoring case", () => {
    expect(vatRate("DK")).toBe(0.25);
    expect(vatRate("dk")).toBe(0.25);
    expect(vatRate("DE")).toBe(0.19);
    expect(vatRate("GB")).toBe(0.2);
  });

  it("has no rate for countries without one in the table", () => {
    expect(vatRate("US")).toBeNull();
    expect(vatRate("XX")).toBeNull();
    expect(vatRate(undefined)).toBeNull();
  });
});

describe("margin after VAT", () => {
  it("takes VAT out of the price before profit", () => {
    expect(withVat(marginMath(43.2, 10.1)!, 0.25)).toEqual({ netPrice: 34.56, profitAfterVat: 22.91, breakEvenAfterVat: 22.91 });
  });

  it("leaves the US margin unchanged", () => {
    expect(marginMath(43.2, 10.1)!.profit).toBe(31.55);
  });

  it("floors the break-even ad cost at 0 when profit after VAT is negative", () => {
    const r = withVat(marginMath(10, 9)!, 0.25);
    expect(r.breakEvenAfterVat).toBe(0);
    expect(r.profitAfterVat).toBeLessThan(0);
  });
});
