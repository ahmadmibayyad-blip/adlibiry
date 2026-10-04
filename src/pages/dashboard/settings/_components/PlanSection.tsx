import { useState } from "react";
import { Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import ProCheckoutDialog from "@/components/billing/ProCheckoutDialog.tsx";
import ProReturnHandler from "@/components/billing/ProReturnHandler.tsx";
import { PRO_PRICE_EUR } from "@/lib/stripe.ts";

export default function PlanSection() {
  const { isPro, isLoading } = useUserPlan();
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <ProReturnHandler />
      <h2 className="font-semibold text-sm mb-4">Plan &amp; billing</h2>

      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : (
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
                  {isPro ? "Pro" : "Free"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isPro
                  ? "Every result is unlocked. Pro runs a month per payment; renew here when it ends."
                  : `You see the first 10 results of each list. Pro unlocks everything for €${PRO_PRICE_EUR}/month.`}
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
      )}
      <ProCheckoutDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
