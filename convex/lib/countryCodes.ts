// Normalizes the country formats our sources send into ISO alpha-2:
//   • alpha-2 ("DK")               — Meta Ad Library, WinningHunter
//   • alpha-3 ("DNK")              — AdLibrary.com docs + ad-detail
//   • English names ("Denmark")    — AdLibrary.com live search results
// Unknown values return undefined — never a guessed code (the old
// `.slice(0, 2)` turned "Germany" into "GE" and "Sweden" into "SW").

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  USA: "US", GBR: "GB", DEU: "DE", FRA: "FR", DNK: "DK", SWE: "SE", NOR: "NO", FIN: "FI", ISL: "IS",
  NLD: "NL", BEL: "BE", LUX: "LU", ESP: "ES", PRT: "PT", ITA: "IT", AUT: "AT", CHE: "CH", IRL: "IE",
  POL: "PL", CZE: "CZ", SVK: "SK", HUN: "HU", ROU: "RO", BGR: "BG", GRC: "GR", HRV: "HR", SVN: "SI",
  EST: "EE", LVA: "LV", LTU: "LT", CYP: "CY", MLT: "MT", ARE: "AE", SAU: "SA", QAT: "QA", KWT: "KW",
  BHR: "BH", OMN: "OM", EGY: "EG", MAR: "MA", TUR: "TR", ISR: "IL", AUS: "AU", NZL: "NZ", CAN: "CA",
  MEX: "MX", BRA: "BR", ARG: "AR", CHL: "CL", COL: "CO", ZAF: "ZA", IND: "IN", JPN: "JP", KOR: "KR",
  SGP: "SG", MYS: "MY", THA: "TH", PHL: "PH", IDN: "ID", VNM: "VN", HKG: "HK", TWN: "TW", CHN: "CN",
  UKR: "UA", RUS: "RU",
};

const NAME_TO_ALPHA2: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "united kingdom": "GB", uk: "GB",
  "great britain": "GB", germany: "DE", france: "FR", denmark: "DK", sweden: "SE", norway: "NO",
  finland: "FI", iceland: "IS", netherlands: "NL", "the netherlands": "NL", belgium: "BE",
  luxembourg: "LU", spain: "ES", portugal: "PT", italy: "IT", austria: "AT", switzerland: "CH",
  ireland: "IE", poland: "PL", "czech republic": "CZ", czechia: "CZ", slovakia: "SK", hungary: "HU",
  romania: "RO", bulgaria: "BG", greece: "GR", croatia: "HR", slovenia: "SI", estonia: "EE",
  latvia: "LV", lithuania: "LT", cyprus: "CY", malta: "MT", "united arab emirates": "AE", uae: "AE",
  "saudi arabia": "SA", qatar: "QA", kuwait: "KW", bahrain: "BH", oman: "OM", egypt: "EG",
  morocco: "MA", turkey: "TR", "türkiye": "TR", israel: "IL", australia: "AU", "new zealand": "NZ",
  canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR", chile: "CL", colombia: "CO",
  "south africa": "ZA", india: "IN", japan: "JP", "south korea": "KR", singapore: "SG",
  malaysia: "MY", thailand: "TH", philippines: "PH", indonesia: "ID", vietnam: "VN",
  "hong kong": "HK", taiwan: "TW", china: "CN", ukraine: "UA", russia: "RU",
};

export function toAlpha2(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper === "UK") return "GB";
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (/^[A-Z]{3}$/.test(upper) && ALPHA3_TO_ALPHA2[upper]) return ALPHA3_TO_ALPHA2[upper];
  return NAME_TO_ALPHA2[raw.toLowerCase()];
}

// Maps a list, drops unknowns and duplicates, keeps order.
export function toAlpha2List(values: unknown, max = 60): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const code = toAlpha2(v);
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= max) break;
  }
  return out;
}
