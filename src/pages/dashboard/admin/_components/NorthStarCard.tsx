import { useQuery } from "convex/react";
import { Target } from "lucide-react";
import { api } from "@/convex/_generated/api.js";

const STAGES = [
  { key: "product_open", label: "Opened a product" },
  { key: "verdict_view", label: "Saw its verdict" },
  { key: "product_save", label: "Saved it" },
  { key: "supplier_click", label: "Opened a supplier" },
] as const;

// North star (convex/lib/northStar.ts): weekly validated tests per active user,
// and the funnel behind it.
export default function NorthStarCard() {
  const data = useQuery(api.events.weekly, {});
  if (!data) return null;
  const top = Math.max(1, ...STAGES.map((s) => data.funnel[s.key]));
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">North star: validated tests per active user</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Last 7 days. A validated test = a user saw a product's verdict and saved it.
      </p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Per active user</div>
          <div className="text-lg font-semibold tabular-nums">{data.perActiveUser}</div>
        </div>
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Validated tests</div>
          <div className="text-lg font-semibold tabular-nums">{data.validatedTests}</div>
        </div>
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Active users</div>
          <div className="text-lg font-semibold tabular-nums">{data.activeUsers}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {STAGES.map((s) => (
          <div key={s.key} className="text-xs">
            <div className="flex justify-between mb-0.5">
              <span>{s.label}</span>
              <span className="tabular-nums">{data.funnel[s.key]}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${(data.funnel[s.key] / top) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
