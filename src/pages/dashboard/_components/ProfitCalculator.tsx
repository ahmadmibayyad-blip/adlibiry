import { useState } from "react";
import { DollarSign, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export default function ProfitCalculator({ basePrice, baseCost }: { basePrice: number; baseCost: number }) {
  const [price, setPrice] = useState(basePrice);
  const [cost, setCost] = useState(baseCost);
  const [shipping, setShipping] = useState(4.99);

  const profit = price - cost - shipping;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  const roas3 = Math.round(profit * 3 * 100) / 100;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Profit Calculator</h3>
      </div>
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Sell price ($)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="flex-1 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Product cost ($)</label>
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(Number(e.target.value))}
            className="flex-1 bg-input border border-border rounded-md px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Shipping ($)</label>
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
          <span className={cn("font-bold text-sm", profit >= 0 ? "text-green-400" : "text-red-400")}>
            ${profit.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Margin</span>
          <span className={cn("font-bold text-sm", margin >= 30 ? "text-green-400" : margin >= 15 ? "text-yellow-400" : "text-red-400")}>
            {margin}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Profit at 3× ROAS</span>
          <span className="font-bold text-sm text-primary">${roas3}</span>
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
