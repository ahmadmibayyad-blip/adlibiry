import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { NICHES } from "@/convex/lib/category.ts";
import { Switch } from "@/components/ui/switch.tsx";
import { cn } from "@/lib/utils.ts";

type Niche = (typeof NICHES)[number];
const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

// My niches (one tap each) and the morning digest.
export default function NichesSection() {
  const mine = useQuery(api.onboarding.mine, {});
  const setNiches = useMutation(api.onboarding.setNiches);
  const setDigest = useMutation(api.onboarding.setDigest);
  if (!mine) return null;
  const niches = mine.niches as Niche[];
  const toggle = async (n: Niche) => {
    try {
      await setNiches({ niches: niches.includes(n) ? niches.filter((x) => x !== n) : [...niches, n] });
    } catch {
      toast.error("Couldn't save that");
    }
  };
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-sm mb-1">My niches</h2>
        <p className="text-xs text-muted-foreground mb-3">Winning Products, Products and Ad Spy show these first. Tap to add or remove.</p>
        <div className="flex flex-wrap gap-2">
          {NICHES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={niches.includes(n)}
              onClick={() => toggle(n)}
              className={cn(
                "h-8 px-3 rounded-lg border text-xs font-medium cursor-pointer transition-colors",
                niches.includes(n) ? "bg-primary/15 border-primary text-primary" : "border-border bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer">
        <span className="text-sm">
          Morning digest email
          <span className="block text-xs text-muted-foreground">
            Top 5 new winners{niches.length ? " in my niches" : ""} and my alerts, at 8:00{mine.timezone ? ` (${mine.timezone})` : " my time"}.
          </span>
        </span>
        <Switch
          checked={mine.digest}
          onCheckedChange={async (on) => {
            try {
              await setDigest({ enabled: on, timezone: browserTimezone() });
              toast.success(on ? "Morning digest on" : "Morning digest off");
            } catch {
              toast.error("Couldn't change it");
            }
          }}
        />
      </label>
    </div>
  );
}
