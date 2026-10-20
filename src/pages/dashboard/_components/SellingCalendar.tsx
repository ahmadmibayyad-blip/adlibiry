import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { CalendarDays, Gift, PartyPopper, Tag } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { daysUntil, upcoming, type CalendarKind } from "@/convex/lib/sellingCalendar.ts";
import { CALENDAR_COUNTRIES } from "@/convex/lib/calendarCountries.ts";
import { flagOf } from "@/lib/countries.ts";
import { cn } from "@/lib/utils.ts";

// Selling calendar on the dashboard home: the next gift and deal days in the country the user sells to
// (convex/lib/sellingCalendar.ts), when ads should be running for each, and the public holidays (Nager.Date).

const COUNTRY_OPTIONS = Object.entries(CALENDAR_COUNTRIES).sort((a, b) => a[1].localeCompare(b[1]));

const KIND: Record<CalendarKind, { label: string; icon: typeof Gift; tint: string }> = {
  gift: { label: "Gift day", icon: Gift, tint: "bg-brand/10 text-brand-ink" },
  sale: { label: "Deal day", icon: Tag, tint: "bg-primary/10 text-primary" },
  holiday: { label: "Public holiday", icon: PartyPopper, tint: "bg-muted text-muted-foreground" },
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nice = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default function SellingCalendar() {
  const mine = useQuery(api.onboarding.mine, {});
  const [picked, setPicked] = useState<string | null>(null);
  const known = mine?.targetCountry && CALENDAR_COUNTRIES[mine.targetCountry] ? mine.targetCountry : null;
  const country = picked ?? known ?? "US";
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const holidays = useQuery(api.sellingCalendar.holidays, { country, year });
  const load = useAction(api.sellingCalendar.load);
  const asked = useRef(new Set<string>());

  // Holidays not loaded yet for this country: once per visit.
  useEffect(() => {
    if (holidays?.missing && !asked.current.has(country)) {
      asked.current.add(country);
      void load({ country, year }).catch(() => {});
    }
  }, [holidays?.missing, country, year, load]);

  const days = upcoming(country, today, holidays?.days ?? [], 150)
    .filter((d) => d.kind !== "holiday" || daysUntil(d.date, today) <= 60)
    .slice(0, 8);

  return (
    <section aria-labelledby="selling-calendar" className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="selling-calendar" className="font-semibold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-primary" /> Selling calendar
        </h2>
        <select
          value={country}
          onChange={(e) => setPicked(e.target.value)}
          aria-label="Country"
          className="h-10 sm:h-8 rounded-md border border-border bg-background px-2 text-sm"
        >
          {COUNTRY_OPTIONS.map(([code, name]) => (
            <option key={code} value={code}>{`${flagOf(code)} ${name}`}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Gift days need your ads running about 3 weeks ahead (5 for Christmas) so orders arrive in time.
        {!known && mine ? (
          <>
            {" "}
            <Link to="/dashboard/settings" className="text-primary hover:underline">Set the country you sell to</Link> to open on it.
          </>
        ) : null}
      </p>
      <ul className="divide-y divide-border">
        {days.map((d) => {
          const k = KIND[d.kind];
          const left = daysUntil(d.date, today);
          const readyIn = d.readyBy ? daysUntil(d.readyBy, today) : null;
          return (
            <li key={`${d.date}-${d.name}`} className="py-2.5 flex items-center gap-3">
              <span className={cn("w-9 h-9 rounded-lg grid place-items-center shrink-0", k.tint)} title={k.label}>
                <k.icon className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {nice(d.date)} · {left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`}
                </div>
              </div>
              {readyIn !== null ? (
                <span className={cn("text-xs text-right shrink-0", readyIn <= 0 ? "text-warn font-medium" : "text-muted-foreground")}>
                  {readyIn <= 0 ? "Ads should be running now" : <>Ads ready by<br />{nice(d.readyBy!)}</>}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
