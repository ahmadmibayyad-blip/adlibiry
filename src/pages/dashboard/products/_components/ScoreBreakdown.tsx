import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { SCORE_PART_LABELS, SCORE_WEIGHTS, type ScoreParts } from "@/convex/lib/productScore.ts";

// What the score is made of (score model v2, convex/lib/productScore.ts):
// five parts from 0 to 100 and how much each counts. Shown only when the
// product's live score is the v2 score, so the numbers add up.
export default function ScoreBreakdown({ product }: { product: Doc<"products"> }) {
  const parts = product.scoreParts;
  if (!parts || parts.v2 === undefined || parts.v2 !== product.aiScore) return null;
  const keys = Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[];
  return (
    <div className="space-y-2.5 pt-3 mt-3 border-t border-border">
      {keys.map((k) => (
        <div key={k} title={SCORE_PART_LABELS[k].hint}>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span>
              {SCORE_PART_LABELS[k].label}
              <span className="text-muted-foreground"> · counts {Math.round(SCORE_WEIGHTS[k] * 100)}%</span>
            </span>
            <span className="font-semibold tabular-nums">{parts[k]}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${parts[k]}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        The parts are combined, then ranked against every product: a score of 70 beats about 80% of the catalog, 85 the top 5%.
      </p>
    </div>
  );
}
