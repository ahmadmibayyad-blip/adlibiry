import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

// Compact number input filter styled to match FilterSelect, so numeric and
// dropdown filters sit in the same dense row directly on the page.
export default function FilterNumberInput({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 h-8 rounded-full pl-3 pr-2 border bg-card border-border",
        value && "border-primary bg-primary/10",
        className
      )}
    >
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}:</span>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-6 w-16 border-0 shadow-none bg-transparent px-0 text-xs focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}
