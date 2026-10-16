import { describe, expect, it } from "vitest";
import { anyCountryName, countryLanguage, flagOf } from "./countries.ts";

describe("countries", () => {
  it("draws flags, names any country and knows the language a store there writes in", () => {
    expect(flagOf("SE")).toBe("🇸🇪");
    expect(flagOf("sweden")).toBe("");
    expect(anyCountryName("JP")).toBe("Japan");
    expect(countryLanguage("AT")).toBe("German");
    expect(countryLanguage("JP")).toBeUndefined();
    expect(countryLanguage(null)).toBeUndefined();
  });
});
