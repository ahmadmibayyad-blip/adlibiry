import { useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart.tsx";
import { compactNumber } from "@/lib/adFormat.ts";
import { SERIES, type Point, type Range } from "./chartUtils.ts";

// Shared chart building blocks for the product and ad detail pages.
// One measure per chart and one axis per chart. Series colours come from the
// app's chart tokens; the three used together (chart-2 blue, chart-4 purple,
// chart-1 green) pass the colour-blind separation check in light and dark.

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

export function RangeSwitch({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex items-center bg-card border border-border rounded-lg p-1" role="tablist" aria-label="Time range">
      {([7, 30, 90] as const).map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "px-3 h-7 rounded-md text-xs cursor-pointer",
            value === r ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r} days
        </button>
      ))}
    </div>
  );
}

// Shown until there are 2 daily points. `firstDay` = the one saved so far.
export function CollectingData({ className, firstDay }: { className?: string; firstDay?: string }) {
  return (
    <div className={cn("h-44 flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-border px-4", className)}>
      <p className="text-sm font-medium">Collecting data — charts appear after 2 days</p>
      <p className="text-xs text-muted-foreground max-w-xs">
        {firstDay
          ? `History started ${dayLabel(firstDay)}. The next point is saved tomorrow at 08:05 UTC.`
          : "Numbers are saved once a day at 08:05 UTC."}
      </p>
    </div>
  );
}

// A titled card with an optional headline number and a table view of the
// same numbers (so nothing is only readable by hovering).
export function ChartCard({
  title,
  headline,
  points,
  format = compactNumber,
  children,
  enough,
  firstDay,
}: {
  title: string;
  headline?: ReactNode;
  points: Point[];
  format?: (n: number) => string;
  children: ReactNode;
  enough: boolean;
  firstDay?: string;
}) {
  const [table, setTable] = useState(false);
  return (
    <div className="bg-card border border-border rounded-xl p-4 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {enough && headline}
          {enough && (
            <button
              onClick={() => setTable((t) => !t)}
              className={cn("p-1 rounded cursor-pointer hover:text-foreground", table && "text-foreground bg-muted")}
              title={table ? "Show chart" : "Show as table"}
              aria-pressed={table}
            >
              <Table2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {!enough ? (
        <CollectingData firstDay={firstDay} />
      ) : table ? (
        <div className="h-44 overflow-y-auto text-xs">
          <table className="w-full">
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day} className="border-b border-border last:border-0">
                  <td className="py-1 text-muted-foreground">{dayLabel(p.day)}</td>
                  <td className="py-1 text-right tabular-nums">{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

const axisProps = { tickLine: false, axisLine: false, tickMargin: 6, fontSize: 11 } as const;

function config(label: string, color: string): ChartConfig {
  return { value: { label, color } };
}

export function TimeChart({
  kind,
  points,
  label,
  color = SERIES.primary,
  format = compactNumber,
  reference,
  domain,
}: {
  kind: "area" | "bar" | "line";
  points: Point[];
  label: string;
  color?: string;
  format?: (n: number) => string;
  reference?: { y: number; label: string };
  domain?: [number, number];
}) {
  const data = points.map((p) => ({ ...p, label: dayLabel(p.day) }));
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis dataKey="label" {...axisProps} minTickGap={24} />
      <YAxis {...axisProps} width={56} tickFormatter={(v: number) => format(v)} domain={domain} />
      <ChartTooltip
        cursor={kind === "bar" ? { fill: "var(--muted)", opacity: 0.5 } : { stroke: "var(--muted-foreground)", strokeWidth: 1 }}
        content={
          <ChartTooltipContent
            indicator="line"
            formatter={(v, _name, item) => (
              <div className="grid gap-0.5">
                <span className="text-muted-foreground">{(item?.payload as { label?: string } | undefined)?.label}</span>
                <span className="font-semibold tabular-nums">
                  {format(Number(v))} <span className="font-normal text-muted-foreground">{label}</span>
                </span>
              </div>
            )}
          />
        }
      />
      {reference && (
        <ReferenceLine
          y={reference.y}
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          label={{ value: reference.label, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
        />
      )}
    </>
  );
  return (
    <ChartContainer config={config(label, color)} className="aspect-auto h-44 w-full">
      {kind === "area" ? (
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          {common}
          <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="var(--color-value)" fillOpacity={0.1} />
        </AreaChart>
      ) : kind === "bar" ? (
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap={2}>
          {common}
          <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      ) : (
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          {common}
          <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
        </LineChart>
      )}
    </ChartContainer>
  );
}

// "TikTok 67% · Facebook 33%": one labelled bar per item, largest first.
export function SplitBars({ items, total, empty }: { items: { label: string; value: number }[]; total: number; empty: string }) {
  if (!total) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const pct = Math.round((it.value / total) * 100);
        return (
          <div key={it.label} className="text-xs">
            <div className="flex justify-between mb-1">
              <span>{it.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {it.value} of {total} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${it.label}: ${pct}%`}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SERIES.primary }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One metric vs the niche: bar = this ad (scaled to the niche max), tick = niche median.
export function ComparisonRow({
  label,
  value,
  median,
  max,
  percentile,
  format,
}: {
  label: string;
  value: number;
  median: number;
  max: number;
  percentile: number;
  format: (n: number) => string;
}) {
  const scale = (n: number) => (max > 0 ? Math.min(100, (n / max) * 100) : 0);
  const verdict = percentile >= 50 ? `Top ${Math.max(1, 100 - percentile)}%` : value === median ? "Median" : `Bottom ${Math.max(1, percentile)}%`;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_8.5rem] items-center gap-3 text-xs">
      <span>{label}</span>
      <div className="relative h-2.5 rounded-full bg-muted" title={`This ad ${format(value)} · niche median ${format(median)}`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${scale(value)}%`, background: SERIES.primary }} />
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground" style={{ left: `calc(${scale(median)}% - 1px)` }} />
      </div>
      <span className="tabular-nums">
        {format(value)} <span className="text-muted-foreground">· {verdict}</span>
      </span>
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-muted/60 rounded-lg px-3 py-2.5 min-w-0" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
