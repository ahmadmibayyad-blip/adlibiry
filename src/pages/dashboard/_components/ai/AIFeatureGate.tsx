import { Lock, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";

export default function AIFeatureGate({ children }: { children: React.ReactNode }) {
  const { isPro, isLoading } = useUserPlan();

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  if (!isPro) {
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-5 text-center">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-3">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <h3 className="font-semibold text-sm mb-1">AI Intelligence is a Pro feature</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Upgrade to Pro to unlock AI scoring, ad angles, niche reports, and competitor finding.
        </p>
        <Button asChild size="sm">
          <Link to="/#pricing">
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            Upgrade to Pro
          </Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
