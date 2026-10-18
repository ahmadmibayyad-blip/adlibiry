// An ad's stage, the label shown on its card: Scaling, Winning or Testing.
// WinningHunter-style rules on the numbers we have:
// - Scaling: what the pipeline already marks (lib/scaling.ts).
// - Winning: running more than 7 days with estimated spend of $100+, the same
//   figure as the card's spend (lib/euSpend.ts: EU reach × the user's CPM, else
//   the top of the source's range).
// - Testing: still live and either 7 days old or less, or under 1,000 views.
// Stopped ads and ones that fit none of these get no label. Pure, unit tested.
import { parseCompact } from "./productMatch";
import { estimatedSpendUsd } from "./euSpend";

export type AdStage = "scaling" | "winning" | "testing";

export const WINNING_MIN_DAYS = 7; // more than this
export const WINNING_MIN_SPEND = 100; // USD
export const TESTING_MAX_VIEWS = 1000; // fewer than this

export const STAGE_INFO: Record<AdStage, { label: string; hint: string }> = {
  scaling: { label: "Scaling", hint: "Scaling: running 14+ days and still getting budget" },
  winning: { label: "Winning", hint: "Winning: running more than 7 days with an estimated $100+ spent" },
  testing: { label: "Testing", hint: "Testing: 7 days old or less, or under 1,000 views so far" },
};

export function adStage(a: {
  isActive?: boolean;
  isScaling?: boolean;
  daysRunning: number;
  spendEstimate?: string;
  impressions?: number;
  views?: string;
  audience?: { totalReach?: number } | null;
}, cpm?: number): AdStage | undefined {
  if (a.isActive === false) return undefined;
  if (a.isScaling) return "scaling";
  const spend = estimatedSpendUsd(a, cpm);
  if (a.daysRunning > WINNING_MIN_DAYS && (spend ?? 0) >= WINNING_MIN_SPEND) return "winning";
  const views = a.impressions ?? parseCompact(a.views);
  if (a.daysRunning <= WINNING_MIN_DAYS || (views !== undefined && views < TESTING_MAX_VIEWS)) return "testing";
  return undefined;
}
