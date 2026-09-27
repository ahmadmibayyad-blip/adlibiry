import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils.ts";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-sm mb-1">Appearance</h2>
      <p className="text-xs text-muted-foreground mb-4">Choose how AdSpy Pro looks on this device.</p>
      <div className="flex items-center gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                active
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
