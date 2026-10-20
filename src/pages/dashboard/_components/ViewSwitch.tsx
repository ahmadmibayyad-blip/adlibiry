import { cn } from "@/lib/utils.ts";
import { useSimpleView } from "@/hooks/use-simple-view.ts";

// Simple / Full switch for the dashboard (see use-simple-view.ts).
export default function ViewSwitch({ className }: { className?: string }) {
  const [simple, setSimple] = useSimpleView();
  const option = (label: string, on: boolean, value: boolean) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setSimple(value)}
      className={cn(
        "flex-1 h-9 px-3 rounded-full text-xs font-semibold transition-colors cursor-pointer",
        on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Dashboard view" className={cn("flex bg-muted rounded-full p-0.5", className)}>
      {option("Simple", simple, true)}
      {option("Full", !simple, false)}
    </div>
  );
}
