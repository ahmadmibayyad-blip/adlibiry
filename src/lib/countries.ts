// Countries supported by the Country Saturation Analyzer. Kept as a small,
// curated list matching the countries AdSpy Pro's Ad Spy/Store Tracker data
// actually covers, plus common dropshipping target markets.
export const SATURATION_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
] as const;

export function countryName(code: string): string {
  return SATURATION_COUNTRIES.find((c) => c.code === code)?.name ?? anyCountryName(code);
}

/** The flag emoji of a two-letter country code ("SE" → 🇸🇪); "" for anything else. */
export function flagOf(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

/** Any country's English name from the browser's own country data; the code when it has none. */
export function anyCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// The language a store in the country most likely writes in, for Launch when the store's own language is unknown
// (only languages Launch writes in).
const COUNTRY_LANGUAGE: Record<string, string> = {
  US: "English", GB: "English", IE: "English", CA: "English", AU: "English", NZ: "English", AE: "English", SA: "English",
  DK: "Danish", SE: "Swedish", NO: "Norwegian", FI: "Finnish", DE: "German", AT: "German", CH: "German",
  FR: "French", BE: "French", LU: "French", NL: "Dutch", ES: "Spanish", MX: "Spanish", AR: "Spanish", CO: "Spanish", CL: "Spanish",
  IT: "Italian", PL: "Polish", PT: "Portuguese", BR: "Portuguese",
};
export const countryLanguage = (code: string | null | undefined): string | undefined => (code ? COUNTRY_LANGUAGE[code] : undefined);
