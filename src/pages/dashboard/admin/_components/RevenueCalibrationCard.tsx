import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

const METHOD: Record<string, string> = {
  marketplace_sales: "Marketplace sales counts",
  reported_gmv: "Reported TikTok Shop GMV",
  ad_funnel: "Ad funnel model",
  store: "Store catalog + reviews",
};

// Known-truth revenue set (convex/revenueTruth.ts): stores or products whose
// real monthly revenue is known. Estimates per method are compared with them
// monthly and scaled once a method has 5+ examples.
export default function RevenueCalibrationCard() {
  const data = useQuery(api.revenueTruth.list, {});
  const add = useMutation(api.revenueTruth.add);
  const remove = useMutation(api.revenueTruth.remove);
  const calibrateNow = useMutation(api.revenueTruth.calibrateNow);
  const [form, setForm] = useState({ kind: "store" as "store" | "product", url: "", revenue: "", note: "" });
  if (!data) return null;
  const cal = data.calibration;
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Revenue calibration</h3>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Add 20–50 stores or products whose real monthly revenue you know. Each month our estimates are checked against them, and a
            method with 5 or more examples is corrected by its median error. Stores are matched once they've had a catalog check.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={data.rows.length === 0}
          onClick={async () => {
            try {
              const r = await calibrateNow({});
              toast.success(`Matched ${r.matched} of ${r.rows}`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not calibrate");
            }
          }}
        >
          Check now
        </Button>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_9rem_auto] mb-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await add({ kind: form.kind, url: form.url, monthlyRevenueUsd: Number(form.revenue), note: form.note || undefined });
            setForm({ ...form, url: "", revenue: "", note: "" });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not add it");
          }
        }}
      >
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as "store" | "product" })}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Store or product"
        >
          <option value="store">Store</option>
          <option value="product">Product</option>
        </select>
        <Input placeholder="Store or product page address" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <Input placeholder="Revenue / month, USD" inputMode="decimal" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} />
        <Button type="submit" size="sm" className="h-9">Add</Button>
      </form>

      {data.rows.length > 0 && (
        <ul className="divide-y divide-border text-xs mb-3">
          {data.rows.map((r) => (
            <li key={r._id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate">
                <span className="text-muted-foreground">{r.kind === "store" ? "Store" : "Product"} · </span>
                {r.url}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <strong className="tabular-nums">${r.monthlyRevenueUsd.toLocaleString("en-US")}/mo</strong>
                <button type="button" aria-label="Remove" onClick={() => remove({ id: r._id })} className="text-muted-foreground hover:text-destructive cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {cal && Object.keys(cal.byBasis).length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal py-1">Method</th>
              <th className="text-right font-normal">Examples</th>
              <th className="text-right font-normal">Typical error</th>
              <th className="text-right font-normal">Correction</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cal.byBasis).map(([basis, c]) => (
              <tr key={basis} className="border-t border-border">
                <td className="py-1">{METHOD[basis] ?? basis}</td>
                <td className="text-right tabular-nums">{c.n}</td>
                <td className="text-right tabular-nums">{c.medianErrorPct}%</td>
                <td className="text-right tabular-nums">{c.n >= 5 ? `×${c.factor}` : "needs 5"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
