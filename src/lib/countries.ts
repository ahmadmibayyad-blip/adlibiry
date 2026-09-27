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
  return SATURATION_COUNTRIES.find((c) => c.code === code)?.name ?? code;
}
