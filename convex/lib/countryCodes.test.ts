import { describe, expect, it } from "vitest";
import { countCountries } from "./countryCodes";

describe("countCountries", () => {
  it("counts every spelling of a country once", () => {
    expect(countCountries(["IE", "IRELAND", "IRL"])).toBe(1);
  });
  it("counts a city as its country", () => {
    expect(countCountries(["HAMBURG, GERMANY", "OLDENBURG, GERMANY", "DE"])).toBe(1);
  });
  it("skips regions", () => {
    expect(countCountries(["WORLDWIDE", "EUROPE", "EURO AREA", "EUROPEAN ECONOMIC AREA (EEA)", "US"])).toBe(1);
  });
});
