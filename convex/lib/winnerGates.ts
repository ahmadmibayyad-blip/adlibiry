// Gates a product must pass to be listed in Winning Products (and get a
// "#N in <niche>" badge), on top of the score. A high score alone isn't
// enough: a winner needs real sales, several live ads, momentum that isn't
// falling, and room left in the market.

export const WINNER_GATES = {
  minRevenuePerMonth: 10_000, // USD, point estimate
  minActiveAds: 3,
  minMomentumPercent: 0, // views change over 14 days: not falling
  maxSaturation: "Medium" as const, // "High" is out
};

export type GateInput = {
  revenuePerMonth?: number;
  activeAds: number;
  momentum14?: number; // percent; undefined = not enough history yet
  saturation?: string;
};

export type GateResult = { ok: true } | { ok: false; reason: "revenue" | "ads" | "momentum" | "saturation" };

export function passesWinnerGates(p: GateInput): GateResult {
  if (!(p.revenuePerMonth !== undefined && p.revenuePerMonth >= WINNER_GATES.minRevenuePerMonth)) return { ok: false, reason: "revenue" };
  if (p.activeAds < WINNER_GATES.minActiveAds) return { ok: false, reason: "ads" };
  if (p.momentum14 !== undefined && p.momentum14 < WINNER_GATES.minMomentumPercent) return { ok: false, reason: "momentum" };
  if (p.saturation === "High") return { ok: false, reason: "saturation" };
  return { ok: true };
}

// Same gates, but data we don't have yet (no revenue estimate, no ad count)
// doesn't fail a product; only the numbers we do have can. Used to fill a
// niche when too few products pass the full gates, so missing data never
// empties Winning Products.
export function passesKnownGates(p: Omit<GateInput, "activeAds"> & { activeAds?: number }): boolean {
  if (p.revenuePerMonth !== undefined && p.revenuePerMonth < WINNER_GATES.minRevenuePerMonth) return false;
  if (p.activeAds !== undefined && p.activeAds < WINNER_GATES.minActiveAds) return false;
  if (p.momentum14 !== undefined && p.momentum14 < WINNER_GATES.minMomentumPercent) return false;
  if (p.saturation === "High") return false;
  return true;
}
