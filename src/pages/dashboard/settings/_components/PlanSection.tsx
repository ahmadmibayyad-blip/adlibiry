import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Crown, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { cn } from "@/lib/utils.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import ProCheckoutDialog from "@/components/billing/ProCheckoutDialog.tsx";
import ProReturnHandler from "@/components/billing/ProReturnHandler.tsx";
import { PRO_PRICE_EUR, PRO_YEARLY_PER_MONTH_EUR, proCharge } from "@/lib/stripe.ts";

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export default function PlanSection() {
  const { isPro, isLoading } = useUserPlan();
  const billing = useQuery(api.proPlan.myBilling, {});
  const setAutoRenew = useMutation(api.proPlan.setAutoRenew);
  const [open, setOpen] = useState(false);

  const toggleRenew = async (on: boolean) => {
    try {
      await setAutoRenew({ autoRenew: on });
      toast.success(on ? "Auto-renew is on." : "Auto-renew is off. Pro stays until the end of your paid period.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? "Couldn't change it.") : "Couldn't change it.");
    }
  };

  const renewNote = (() => {
    if (!isPro || !billing?.periodEnd) return "Every result is unlocked.";
    const amount = proCharge(billing.period);
    return billing.autoRenew
      ? `Renews automatically on ${day(billing.periodEnd)} for €${amount}.`
      : `Pro ends on ${day(billing.periodEnd)}. Turn on auto-renew to keep it.`;
  })();

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <ProReturnHandler />
      <h2 className="font-semibold text-sm mb-4">Plan &amp; billing</h2>

      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Crown className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Current plan</span>
                  <Badge
                    variant="outline"
                    className={cn("text-xs", isPro ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border")}
                  >
                    {isPro ? `Pro${billing ? ` · ${billing.period}` : ""}` : "Free"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isPro
                    ? renewNote
                    : `You see the first 10 results of each list. Pro unlocks everything: €${PRO_PRICE_EUR}/month, or €${PRO_YEARLY_PER_MONTH_EUR}/month paid yearly.`}
                </p>
              </div>
            </div>

            {!isPro && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Upgrade to Pro
              </Button>
            )}
          </div>

          {isPro && billing?.canAutoRenew && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer">
              <span className="text-sm">
                Auto-renew
                <span className="block text-xs text-muted-foreground">Charge your saved card when the period ends.</span>
              </span>
              <Switch checked={billing.autoRenew} onCheckedChange={toggleRenew} />
            </label>
          )}

          {!isPro && billing?.lastError && (
            <p className="text-xs text-destructive">Your last renewal payment didn't go through. Upgrade again to restore Pro.</p>
          )}
        </div>
      )}
      <ProCheckoutDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
