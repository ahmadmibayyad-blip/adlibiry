import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Loader2, CreditCard, Crown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import { useNavigate } from "react-router-dom";

const planColors: Record<string, string> = {
  starter: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  pro: "bg-primary/10 text-primary border-primary/20",
  agency: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  none: "bg-muted text-muted-foreground border-border",
};

const planLabels: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  agency: "Agency",
  none: "Free",
};

export default function PlanSection() {
  const navigate = useNavigate();
  const { plan, isLoading } = useUserPlan();
  const getBillingPortal = useAction(api.commerce.getBillingPortal);
  const [portalLoading, setPortalLoading] = useState(false);

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const { url } = await getBillingPortal({ returnUrl: window.location.href });
      window.open(url, "_blank");
    } catch {
      toast.error("No billing account found yet. Upgrade to a paid plan first.");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
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
                <Badge variant="outline" className={cn("text-xs capitalize", planColors[plan])}>
                  {planLabels[plan]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {plan === "none"
                  ? "Upgrade to unlock AI tools, unlimited ad spy, and more."
                  : "Manage your subscription, invoices, and payment method."}
              </p>
            </div>
          </div>

          {plan === "none" ? (
            <Button size="sm" onClick={() => navigate("/#pricing")}>
              View plans
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={handleManageBilling} disabled={portalLoading}>
              {portalLoading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <CreditCard className="w-3.5 h-3.5 mr-1.5" />
              )}
              Manage billing
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
