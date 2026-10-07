import { useMutation, useQuery } from "convex/react";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;

type Side = { share85: number; share70: number; median: number; buckets: number[] };

function Distribution({ title, side, highlight }: { title: string; side: Side; highlight?: boolean }) {
  const max = Math.max(1, ...side.buckets);
  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-primary/40 bg-primary/5" : "border-border")}>
      <div className="text-xs font-semibold mb-2">{title}</div>
      <div className="flex items-end gap-1 h-16" aria-hidden="true">
        {side.buckets.map((n, i) => (
          <div key={i} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (n / max) * 100)}%` }} title={`${i * 10}–${i * 10 + 9}: ${n}`} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
        <div><div className="text-muted-foreground">85+</div><strong>{pct(side.share85)}</strong></div>
        <div><div className="text-muted-foreground">70+</div><strong>{pct(side.share70)}</strong></div>
        <div><div className="text-muted-foreground">Median</div><strong>{side.median}</strong></div>
      </div>
    </div>
  );
}

// Score model v2: the daily pipeline computes the new scores next to the live
// ones; this card shows both distributions and switches which one is live.
export default function ScoreModelCard() {
  const data = useQuery(api.productPipeline.scoreCalibration, {});
  const setModel = useMutation(api.productPipeline.setScoreModel);
  if (!data) return null;
  const { model, report } = data;
  const switchTo = async (next: "v1" | "v2") => {
    try {
      await setModel({ model: next });
      toast.success(next === "v2" ? "New scores go live with this run" : "Back to the old scores with this run");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch");
    }
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Product scores</h3>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            New model: ad momentum, revenue, trend, competition and margin, ranked across all products (target: median about 45, 20% at
            70+, 5% at 85+). Live now: <strong className="text-foreground">{model === "v2" ? "new scores" : "old scores"}</strong>.
          </p>
        </div>
        {model === "v1" ? (
          <Button size="sm" disabled={!report} onClick={() => switchTo("v2")}>Switch to new scores</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => switchTo("v1")}>Back to old scores</Button>
        )}
      </div>
      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Distribution title={`Live scores (${model === "v2" ? "new" : "old"} model)`} side={report.before} />
            <Distribution title="New model" side={report.after} highlight />
          </div>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Top 20 under the new model ({report.total.toLocaleString("en-US")} products scored {report.day})</summary>
            <table className="w-full mt-2">
              <thead className="text-muted-foreground">
                <tr><th className="text-left font-normal py-1">Product</th><th className="text-right font-normal">Live</th><th className="text-right font-normal">New</th></tr>
              </thead>
              <tbody>
                {report.top.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-2 truncate max-w-[16rem]"><a href={`/dashboard/products/${r.id}`} className="hover:underline">{r.title}</a></td>
                    <td className="text-right tabular-nums">{r.old}</td>
                    <td className="text-right tabular-nums font-semibold">{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">The comparison appears after the next daily run (or press Run now above).</p>
      )}
    </div>
  );
}
