import { useId, useState } from "react";
import { DollarSign, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { displayCurrency } from "@/lib/money.ts";
import { formatMoney } from "@/convex/lib/currency.ts";

// Works in the user's display currency: the product's USD price and cost are
// converted once, then the user types their own numbers.
export default function ProfitCalculator({ basePrice, baseCost }: { basePrice: number; baseCost: number }) {
  const { code, rate } = displayCurrency();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Kept as typed, so an emptied field stays empty while retyping; blanks count as 0.
  const [priceText, setPrice] = useState(String(round2(basePrice * rate)));
  const [costText, setCost] = useState(String(round2(baseCost * rate)));
  const [shippingText, setShipping] = useState(String(round2(4.99 * rate)));
  const price = Number(priceText) || 0;
  const cost = Number(costText) || 0;
  const shipping = Number(shippingText) || 0;
  const fmt = (n: number) => formatMoney(n, code, 1);

  const profit = price - cost - shipping;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  // Break-even: the most you can pay in ads per order (CPA), and the ad
  // return you need before an order stops losing money (ROAS = revenue ÷ ad cost).
  const breakEvenCpa = profit;
  const breakEvenRoas = profit > 0 ? price / profit : null;
  // No selling price yet (e.g. an ad not linked to a product): show blanks, not a loss.
  const empty = price <= 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Profit Calculator</h3>
      </div>
      <div className="space-y-3 mb-4">
        <MoneyField label={`Sell price (${code})`} value={priceText} onChange={setPrice} />
        <MoneyField label={`Product cost (${code})`} value={costText} onChange={setCost} />
        <MoneyField label={`Shipping (${code})`} value={shippingText} onChange={setShipping} />
      </div>
      <div className="border-t border-border pt-4 space-y-2 tabular-nums" aria-live="polite">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Profit per order</span>
          <span className={cn("font-bold text-sm", empty ? "text-muted-foreground" : profit >= 0 ? "text-good" : "text-bad")}>
            {empty ? "—" : fmt(profit)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Margin</span>
          <span className={cn("font-bold text-sm", empty ? "text-muted-foreground" : margin >= 30 ? "text-good" : margin >= 15 ? "text-warn" : "text-bad")}>
            {empty ? "—" : `${margin}%`}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Break-even CPA</span>
          <span className="font-bold text-sm">{empty ? "—" : breakEvenCpa > 0 ? fmt(breakEvenCpa) : "Not profitable"}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Break-even ROAS</span>
          <span className="font-bold text-sm">{empty ? "—" : breakEvenRoas ? `${breakEvenRoas.toFixed(2)}×` : "Not profitable"}</span>
        </div>
      </div>
      {empty ? (
        <p className="mt-3 text-xs text-muted-foreground">Enter your selling price and supplier cost to see your profit per order.</p>
      ) : margin < 20 && (
        <div className="flex items-start gap-2 mt-3 bg-warn/10 border border-warn/20 rounded-lg p-2.5 text-xs text-warn">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Margin below 20% — consider raising price or negotiating cost.
        </div>
      )}
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-xs text-muted-foreground w-24 shrink-0">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
