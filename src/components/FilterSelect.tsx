import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";

export type FilterSelectOption = { value: string; label: string };

// Compact dropdown filter used to lay many filters out in a row directly on
// the page (Ad Spy, Winning Products, Store Tracker), matching the dense
// filter-bar layout dropshippers expect from other ad-spy tools. Each
// dropdown always carries a leading "Any ..." option so it round-trips to
// `undefined` (no filter applied).
export default function FilterSelect({
  label,
  value,
  onChange,
  options,
  active,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
  active?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className={cn(
          "h-8 text-xs rounded-full px-3 gap-1 bg-card border-border",
          active && "border-primary text-primary bg-primary/10"
        )}
      >
        <span className="text-muted-foreground font-normal mr-0.5">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
