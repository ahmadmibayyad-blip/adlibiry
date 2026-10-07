import { Check, X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils.ts";

// "My niches" filter (the niches from onboarding / Settings), on by default.
export default function MyNichesChip({ niches, on, onToggle }: { niches: string[]; on: boolean; onToggle: () => void }) {
  if (!niches.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        title={niches.join(", ")}
        className={cn(
          "flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs border cursor-pointer whitespace-nowrap",
          on ? "bg-primary/15 border-primary text-primary font-medium" : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        {on ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
        My niches ({niches.length})
      </button>
      <Link to="/dashboard/settings" className="text-[11px] text-muted-foreground hover:text-foreground underline">
        change
      </Link>
    </span>
  );
}
