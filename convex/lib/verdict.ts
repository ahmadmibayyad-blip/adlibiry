// "Should I test this?" (roadmap P1-B): four plain checks and one verdict
// line, from data the product already has. Pure, unit tested; the product
// page shows it (src/pages/dashboard/products/_components/VerdictPanel.tsx).

import { pointEstimate, revenueConfidence } from "./estimates";

export type Check = { key: "demand" | "room" | "margin" | "angles"; ok: boolean | null; label: string; detail: string };
export type Verdict = { checks: Check[]; call: "test" | "maybe" | "skip"; line: string };

export type VerdictInput = {
  estRevenue?: { low: number; high: number };
  estBasis?: { revenue?: string };
  trend?: string;
  momentum14?: number;
  saturation?: string;
  saturationByCountry?: { country: string; advertisers: number; level: string }[];
  price?: number;
  cost?: number;
  angleCount: number; // distinct ad hooks we've seen for it
  targetCountry?: string;
};

const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${Math.round(n)}`);

export function verdict(p: VerdictInput): Verdict {
  // Demand: ~$10K+/month and views not falling.
  const revenue = pointEstimate(p.estRevenue);
  const confidence = revenueConfidence(p.estBasis?.revenue);
  const falling = p.momentum14 !== undefined ? p.momentum14 < 0 : p.trend === "Declining";
  const rising = p.momentum14 !== undefined ? p.momentum14 > 0 : p.trend === "Rising";
  const demandOk = revenue === undefined ? null : revenue >= 10_000 && !falling;
  const demand: Check = {
    key: "demand",
    ok: demandOk,
    label: "Demand",
    detail:
      revenue === undefined
        ? "No sales estimate yet"
        : `~${money(revenue)}/mo${confidence ? ` (${confidence.toLowerCase()} confidence)` : ""}, views ${falling ? "falling" : rising ? "rising" : "steady"}`,
  };

  // Room left: competition in their country if we have it, else overall.
  const local = p.targetCountry ? p.saturationByCountry?.find((c) => c.country === p.targetCountry) : undefined;
  const level = local?.level ?? (p.saturation && p.saturation !== "Unknown" ? p.saturation : undefined);
  const room: Check = {
    key: "room",
    ok: level === undefined ? null : level !== "High",
    label: "Room left",
    detail: local
      ? `${local.advertisers} advertiser${local.advertisers === 1 ? "" : "s"} in ${local.country} this week (${local.level.toLowerCase()} competition)`
      : level
        ? `${level} competition overall${p.targetCountry ? `, none seen in ${p.targetCountry} yet` : ""}`
        : "Not enough ad data yet",
  };

  // Margin: 30%+ after supplier cost.
  const marginPct = p.price && p.cost && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined;
  const margin: Check = {
    key: "margin",
    ok: marginPct === undefined ? null : marginPct >= 30,
    label: "Margin",
    detail: marginPct === undefined ? "Supplier cost not known yet" : `~${marginPct}% (sells $${p.price}, costs ~$${p.cost})`,
  };

  // Angle bank: 3+ different hooks to learn from.
  const angles: Check = {
    key: "angles",
    ok: p.angleCount >= 3 ? true : p.angleCount > 0 ? false : null,
    label: "Angle bank",
    detail: p.angleCount ? `${p.angleCount} different ad hook${p.angleCount === 1 ? "" : "s"} to learn from` : "No ads with hooks yet",
  };

  const checks = [demand, room, margin, angles];
  const call: Verdict["call"] = demand.ok === false || room.ok === false ? "skip" : demand.ok && room.ok && margin.ok !== false ? "test" : "maybe";
  const parts = [
    room.ok !== null ? (local ? `${local.level.toLowerCase()} saturation in ${local.country}` : `${level?.toLowerCase()} competition`) : null,
    marginPct !== undefined ? `~${marginPct}% margin` : null,
    revenue !== undefined ? `${rising ? "rising" : falling ? "falling" : "steady"} demand` : null,
  ].filter(Boolean);
  const line =
    call === "test"
      ? `Strong test candidate — ${parts.join(", ")}.`
      : call === "skip"
        ? `Skip for now — ${demand.ok === false ? (falling ? "demand is falling" : "sales look small") : `crowded${local ? ` in ${local.country}` : ""}`}${parts.length ? ` (${parts.join(", ")})` : ""}.`
        : `Worth a closer look — ${checks.filter((c) => c.ok === null).map((c) => c.label.toLowerCase()).join(" and ") || "margin is thin"}${checks.some((c) => c.ok === null) ? " still unknown" : ""}.`;
  return { checks, call, line };
}

/** Distinct hooks among a product's ads (normalised headlines). */
export function countAngles(headlines: string[]): number {
  return new Set(headlines.map((h) => h.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()).filter((h) => h.length >= 4)).size;
}
