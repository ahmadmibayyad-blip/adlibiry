import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { CURRENCIES, type CurrencyCode } from "@/convex/lib/currency.ts";
import { cn } from "@/lib/utils.ts";

const NAMES: Record<CurrencyCode, string> = { USD: "US dollar", EUR: "Euro", GBP: "British pound", DKK: "Danish krone" };

export default function CurrencySection() {
  const mine = useQuery(api.currency.mine, {});
  const setMine = useMutation(api.currency.setMine);
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-sm mb-1">Currency</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Prices and estimates are shown in this currency, converted at the latest European Central Bank rate.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={async () => {
              try {
                await setMine({ code: c });
                toast.success(`Showing amounts in ${NAMES[c]}`);
              } catch {
                toast.error("Couldn't change the currency");
              }
            }}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer",
              mine?.code === c ? "bg-primary/10 border-primary text-primary" : "bg-secondary border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-semibold">{c}</span>
            <span className="text-[10px] opacity-80">{NAMES[c]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
