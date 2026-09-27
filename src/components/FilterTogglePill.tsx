import { cn } from "@/lib/utils.ts";

// Compact toggle pill for boolean filters (e.g. "Winner of day only"),
// styled to match FilterSelect/FilterNumberInput so all filter controls sit
// in the same dense row directly on the page.
export default function FilterTogglePill({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "h-8 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-all cursor-pointer border shrink-0",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
