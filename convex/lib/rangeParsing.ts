// Parses AdSpy Pro's honest ranged-estimate strings (never fabricated precise
// numbers) into a comparable dollar/visit ceiling, so range filters can work
// against real range data without ever inventing a fake exact number.
// Handles formats like "$80K–$150K/mo", "60K–100K visits/mo", "$0–$0
// (impression-based est.)", and "Unknown".

function parseMagnitude(raw: string): number | undefined {
  const match = raw.match(/([\d.]+)\s*([KMB]?)/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return undefined;
  const unit = match[2]?.toUpperCase();
  if (unit === "K") return value * 1_000;
  if (unit === "M") return value * 1_000_000;
  if (unit === "B") return value * 1_000_000_000;
  return value;
}

// Returns the upper bound of a range string like "$80K–$150K/mo" as a plain
// dollar number (150000), or undefined if the string carries no numbers
// (e.g. "Unknown").
export function parseRangeUpperBound(raw: string): number | undefined {
  const numbers = raw.match(/[\d.]+\s*[KMB]?/gi) ?? [];
  if (numbers.length === 0) return undefined;
  const magnitudes = numbers.map(parseMagnitude).filter((n): n is number => n !== undefined);
  if (magnitudes.length === 0) return undefined;
  return Math.max(...magnitudes);
}

// Both ends of a range string ("$80K–$150K/mo" → 80000 and 150000).
export function parseRangeBounds(raw: string): { low: number; high: number } | undefined {
  const magnitudes = (raw.match(/[\d.]+\s*[KMB]?/gi) ?? []).map(parseMagnitude).filter((n): n is number => n !== undefined);
  if (magnitudes.length === 0) return undefined;
  return { low: Math.min(...magnitudes), high: Math.max(...magnitudes) };
}
