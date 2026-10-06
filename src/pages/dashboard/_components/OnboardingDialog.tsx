import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { NICHES } from "@/convex/lib/category.ts";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

type Niche = (typeof NICHES)[number];
const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

// Shown once after sign-up: which niches do you sell in? They pre-filter the
// app and the morning digest (convex/onboarding.ts). Settings changes them.
export default function OnboardingDialog() {
  const mine = useQuery(api.onboarding.mine, {});
  const complete = useMutation(api.onboarding.complete);
  const [picked, setPicked] = useState<Niche[]>([]);
  const [digest, setDigest] = useState(true);
  const [saving, setSaving] = useState(false);
  const open = mine !== undefined && mine !== null && !mine.onboarded;

  const save = async (niches: Niche[], withDigest: boolean) => {
    setSaving(true);
    try {
      await complete({ niches, digest: withDigest, timezone: browserTimezone() });
      if (niches.length) toast.success("Your app now shows your niches first");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-lg [&>button]:hidden" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Which niches do you sell in?</DialogTitle>
          <DialogDescription>Pick any. Winning Products, Products and Ad Spy will show these first. You can change them in Settings.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NICHES.map((n) => {
            const on = picked.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(on ? picked.filter((p) => p !== n) : [...picked, n])}
                className={cn(
                  "min-h-10 px-3 py-2 rounded-lg border text-xs font-medium text-left cursor-pointer transition-colors",
                  on ? "bg-primary/15 border-primary text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer mt-1">
          <Checkbox checked={digest} onCheckedChange={(v) => setDigest(v === true)} className="mt-0.5" />
          <span>
            Email me the top 5 new winners in my niches each morning
            <span className="block text-xs text-muted-foreground">At 8:00 your time. Unsubscribe any time.</span>
          </span>
        </label>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
          <Button variant="ghost" disabled={saving} onClick={() => save([], false)}>
            Skip for now
          </Button>
          <Button disabled={saving || picked.length === 0} onClick={() => save(picked, digest)}>
            Show me my niches
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
