import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Calculator, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { CALC_DEFAULTS, unitEconomics, type CalcInput } from "@/lib/knowledge.ts";
import { cn } from "@/lib/utils.ts";

// Break-even calculator from the "Unit economics" guide: what a sale leaves
// before ads, so the most you can pay per sale (CPA) and the ROAS to aim for.
// Defaults are the guide's Danish example; it updates as you type.

const FIELDS: { key: keyof CalcInput; label: string; hint: string; unit: "€" | "%" }[] = [
  { key: "price", label: "Selling price", hint: "What the customer pays, VAT included", unit: "€" },
  { key: "vatPct", label: "VAT rate", hint: "25% in Denmark", unit: "%" },
  { key: "cost", label: "Product cost", hint: "What the supplier charges", unit: "€" },
  { key: "shipping", label: "Shipping", hint: "Per order, to the customer", unit: "€" },
  { key: "duty", label: "Duty", hint: "Import duty per order, if any", unit: "€" },
  { key: "feePct", label: "Payment fees", hint: "Usually 2–3% of the price", unit: "%" },
  { key: "refundPct", label: "Refund allowance", hint: "Usually 3–5% of the price", unit: "%" },
];

const eur = (n: number) => `€${n.toFixed(2)}`;

export default function KnowledgeCalculator() {
  const [input, setInput] = useState<CalcInput>(CALC_DEFAULTS);
  const r = unitEconomics(input);
  const loss = r.breakEvenCpa <= 0;

  return (
    <div className="p-5 lg:p-8 max-w-5xl mx-auto">
      <Link to="/dashboard/knowledge" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft className="w-4 h-4" /> Knowledge
      </Link>
      <div className="flex items-center gap-2.5 mb-1">
        <Calculator className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold">Break-even calculator</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        How much you can spend on ads per sale before you lose money, and the ROAS to aim for. Fill in your product's numbers; the example
        is a €39.95 product sold in Denmark.{" "}
        <Link to="/dashboard/knowledge/pricing/unit-economics" className="text-primary hover:underline">
          How it works
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-xs text-muted-foreground">{f.hint}</span>
              </span>
              <span className="relative w-32 shrink-0">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={f.unit === "%" ? 0.5 : 0.01}
                  value={input[f.key]}
                  onChange={(e) => setInput({ ...input, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
                  className={cn(
                    "w-full bg-input border border-border rounded-md py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring",
                    f.unit === "€" ? "pl-6 pr-2.5" : "pl-2.5 pr-7",
                  )}
                />
                <span className={cn("absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none", f.unit === "€" ? "left-2.5" : "right-2.5")}>
                  {f.unit}
                </span>
              </span>
            </label>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setInput(CALC_DEFAULTS)}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Back to the example
          </Button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Result label="Net price (ex VAT)" value={eur(r.net)} />
            <Result label="Break-even CPA" value={eur(r.breakEvenCpa)} hint="The most a sale may cost in ads" tone={loss ? "bad" : "good"} />
            <Result label="Break-even ROAS" value={r.breakEvenRoas ? r.breakEvenRoas.toFixed(2) : "—"} hint="Below this, ads lose money" />
            <Result label="Target ROAS" value={r.targetRoas ? r.targetRoas.toFixed(2) : "—"} hint="Break-even × 1.3: profit and a buffer" tone="primary" />
          </div>
          {loss ? (
            <div className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>Loss:</strong> every sale loses money before you spend anything on ads. Raise the price, sell a bundle, or find a cheaper
                supplier or shipping.
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Each sale leaves <strong className="text-foreground">{eur(r.breakEvenCpa)}</strong> before ads (after {eur(r.fees)} payment fees and{" "}
              {eur(r.refunds)} for refunds). Meta reports ROAS on the VAT-inclusive price, so compare it with these ROAS numbers directly.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Result({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "primary" }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold tabular-nums mt-0.5", tone === "good" && "text-good", tone === "bad" && "text-bad", tone === "primary" && "text-primary")}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
