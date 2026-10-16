// Selling calendar (dashboard home): the days people buy gifts or wait for deals in the user's country, with
// when to have ads running, plus the country's public holidays (Nager.Date, sellingCalendar.ts caches them).
// The gift and deal days are computed here, per country: their dates differ (Mother's Day is in February in
// Norway, three weeks before Easter in the UK, late May in Sweden). Pure: the app and the backend both use it.

export type CalendarKind = "gift" | "sale" | "holiday";
export type CalendarDay = {
  date: string; // YYYY-MM-DD
  name: string;
  kind: CalendarKind;
  /** When ads should be running: gifts need delivery time (dropshipping 1-2 weeks) and a few days of testing. */
  readyBy?: string;
};
export type PublicHoliday = { date: string; name: string; localName: string };

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The n-th weekday (0 = Sunday) of a month; n = -1 for the last one. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(year, month, 1);
    return plus(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(year, month + 1, 0);
  return plus(last, -((last.getUTCDay() - weekday + 7) % 7));
}

const SUN = 0;
const THU = 4;
const NO_CHRISTMAS = new Set(["AE", "SA"]);
const CHRISTMAS_EVE = new Set(["DK", "SE", "NO", "DE"]); // the evening presents are opened

function mothersDay(country: string, year: number): Date | null {
  switch (country) {
    case "GB":
      return plus(easter(year), -21); // Mothering Sunday
    case "SE":
      return nthWeekday(year, 5, SUN, -1);
    case "NO":
      return nthWeekday(year, 2, SUN, 2);
    case "FR": {
      // The last Sunday of May, a week later when that is Pentecost.
      const last = nthWeekday(year, 5, SUN, -1);
      return ymd(last) === ymd(plus(easter(year), 49)) ? plus(last, 7) : last;
    }
    case "ES":
      return nthWeekday(year, 5, SUN, 1);
    case "AE":
    case "SA":
      return utc(year, 3, 21);
    case "US":
    case "CA":
    case "AU":
    case "DE":
    case "DK":
    case "IT":
    case "NL":
      return nthWeekday(year, 5, SUN, 2);
    default:
      return null;
  }
}

function fathersDay(country: string, year: number): Date | null {
  switch (country) {
    case "US":
    case "CA":
    case "GB":
    case "FR":
    case "NL":
      return nthWeekday(year, 6, SUN, 3);
    case "DE":
      return plus(easter(year), 39); // Vatertag, on Ascension Day
    case "DK":
      return utc(year, 6, 5);
    case "SE":
    case "NO":
      return nthWeekday(year, 11, SUN, 2);
    case "AU":
      return nthWeekday(year, 9, SUN, 1);
    case "ES":
    case "IT":
      return utc(year, 3, 19);
    case "AE":
      return utc(year, 6, 21);
    default:
      return null;
  }
}

/** The gift and deal days of a year in a country. */
export function sellingDays(country: string, year: number): CalendarDay[] {
  const out: CalendarDay[] = [];
  const add = (date: Date | null, name: string, kind: "gift" | "sale", leadDays: number) => {
    if (date) out.push({ date: ymd(date), name, kind, readyBy: ymd(plus(date, -leadDays)) });
  };
  const blackFriday = plus(nthWeekday(year, 11, THU, 4), 1);
  add(utc(year, 2, 14), "Valentine's Day", "gift", 21);
  add(mothersDay(country, year), "Mother's Day", "gift", 21);
  add(fathersDay(country, year), "Father's Day", "gift", 21);
  if (!NO_CHRISTMAS.has(country)) add(utc(year, 10, 31), "Halloween", "gift", 21);
  add(utc(year, 11, 11), "Singles' Day (11.11)", "sale", 14);
  add(blackFriday, "Black Friday", "sale", 21);
  add(plus(blackFriday, 3), "Cyber Monday", "sale", 21);
  if (!NO_CHRISTMAS.has(country)) {
    add(utc(year, 12, CHRISTMAS_EVE.has(country) ? 24 : 25), "Christmas", "gift", 35);
    if (country === "GB" || country === "CA" || country === "AU") add(utc(year, 12, 26), "Boxing Day sales", "sale", 14);
  }
  return out;
}

/** What's coming up: gift and deal days and public holidays in the next `horizon` days, soonest first. */
export function upcoming(country: string, today: string, holidays: PublicHoliday[], horizon = 150): CalendarDay[] {
  const start = Date.parse(today);
  const end = start + horizon * DAY;
  const year = new Date(start).getUTCFullYear();
  const days = [...sellingDays(country, year), ...sellingDays(country, year + 1)];
  // A public holiday on a selling day (Christmas, Mother's Day where it's official) is already there.
  const taken = new Set(days.map((d) => d.date));
  for (const h of holidays) if (!taken.has(h.date)) days.push({ date: h.date, name: h.localName && h.localName !== h.name ? `${h.localName} (${h.name})` : h.name, kind: "holiday" });
  const seen = new Set<string>();
  return days
    .filter((d) => Date.parse(d.date) >= start && Date.parse(d.date) <= end)
    .filter((d) => !seen.has(`${d.date}|${d.name}`) && !!seen.add(`${d.date}|${d.name}`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Days from `today` to `date` (both YYYY-MM-DD). */
export const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / DAY);
