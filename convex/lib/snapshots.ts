// Daily history snapshots (dailySnapshots) are only written when something
// changed, so ads and products whose numbers are frozen stop adding a row every
// day. Charts still get one point per day: the history queries fill skipped
// days with the last known values (fillDays). Pure, tested in snapshots.test.ts.

// Write an unchanged entity again after this many days, so it keeps a row
// inside the 90-day retention window and its history never disappears.
export const SNAPSHOT_REFRESH_DAYS = 30;

const VALUE_KEYS = ["score", "adsRunning", "views", "likes", "comments", "spend", "gmv", "trend", "saturation"] as const;
type Values = Partial<Record<(typeof VALUE_KEYS)[number], unknown>>;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// Whether today's values need a new row, given the latest earlier row.
export function shouldWriteSnapshot(prev: ({ day: string } & Values) | null, day: string, values: Values): boolean {
  if (!prev) return true;
  if (daysBetween(prev.day, day) >= SNAPSHOT_REFRESH_DAYS) return true;
  return VALUE_KEYS.some((k) => prev[k] !== values[k]);
}

// One row per day from `from` (or the first known day, if later) to `to`,
// carrying the last known values over days that have no row. `seed` is the
// latest row before `from`, if any; `rows` are the rows from `from` on.
export function fillDays<T extends { day: string }>(seed: T | null, rows: T[], from: string, to: string): T[] {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  let current: T | null = seed;
  const start = seed ? from : sorted[0]?.day;
  if (!start) return [];
  const out: T[] = [];
  let i = 0;
  for (let day = start; day <= to; day = addDays(day, 1)) {
    while (i < sorted.length && sorted[i].day <= day) current = sorted[i++];
    if (current) out.push(current.day === day ? current : { ...current, day });
  }
  return out;
}
