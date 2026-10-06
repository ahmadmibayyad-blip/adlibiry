import { moneyCompact } from "@/lib/money.ts";
import { compactNumber } from "@/lib/adFormat.ts";

// Helpers for the detail-page charts (charts.tsx).

export type Range = 7 | 30 | 90;
export type Point = { day: string; value: number };

// Series colours: app chart tokens. Used together, these three pass the
// colour-blind separation check in light and dark mode.
export const SERIES = {
  primary: "var(--chart-2)",
  second: "var(--chart-4)",
  third: "var(--chart-1)",
};

// Day-over-day change of a running total (views, spend), never negative.
export function dailyChange(points: Point[]): Point[] {
  return points.slice(1).map((p, i) => ({ day: p.day, value: Math.max(0, p.value - points[i].value) }));
}

// Amounts in the user's display currency (lib/money.ts): compact when large.
export const money = (n: number) => moneyCompact(n);
export const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;
