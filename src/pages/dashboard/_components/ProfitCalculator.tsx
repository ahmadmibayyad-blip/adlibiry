import { useState } from "react";
import { DollarSign, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { displayCurrency } from "@/lib/money.ts";
import { formatMoney } from "@/convex/lib/currency.ts";

// Works in the user's display currency: the product's USD price and cost are
// converted once, then the user types their own numbers.
export default function ProfitCalculator({ basePrice, baseCost }: { basePrice: number; baseCost: number }) {
  const { code, rate } = displayCurrency();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const [price, setPrice] = useState(round2(basePrice * rate));
  const [cost, setCost] = useState(round2(baseCost * rate));
  const [shipping, setShipping] = useState(round2(4.99 * rate));
  const fmt = (n: number) => formatMoney(n, code, 1);

  const profit = price - cost - shipping;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  // Break-even: the most you can pay in ads per order (CPA), and the ad
  // return you need before an order stops losing money (ROAS = revenue ÷ ad cost).
  const breakEvenCpa = profit;
  const breakEvenRoas = profit > 0 ? price / profit : null;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Profit Calculator</h3>
      </div>
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Sell price ({code})</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="flex-1 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Product cost ({code})</label>
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(Number(e.target.value))}
            className="flex-1 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Shipping ({code})</label>
          <input
            type="number"
            value={shipping}
            onChange={(e) => setShipping(Number(e.target.value))}
            className="flex-1 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <div className="border-t border-border pt-4 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Profit per order</span>
          <span className={cn("font-bold text-sm", profit >= 0 ? "text-good" : "text-bad")}>
            {fmt(profit)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Margin</span>
          <span className={cn("font-bold text-sm", margin >= 30 ? "text-good" : margin >= 15 ? "text-warn" : "text-bad")}>
            {margin}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Break-even CPA</span>
          <span className="font-bold text-sm">{breakEvenCpa > 0 ? fmt(breakEvenCpa) : "Not profitable"}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Break-even ROAS</span>
          <span className="font-bold text-sm">{breakEvenRoas ? `${breakEvenRoas.toFixed(2)}×` : "Not profitable"}</span>
        </div>
      </div>
      {margin < 20 && (
        <div className="flex items-start gap-2 mt-3 bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-2.5 text-xs text-yellow-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Margin below 20% — consider raising price or negotiating cost.
        </div>
      )}
    </div>
  );
}
