import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { useUserPlan } from "@/hooks/use-user-plan.ts";

// Shown on list pages while the backend caps results (free and trial accounts).
export default function TrialLimitNotice() {
  const limit = useQuery(api.billing.myResultLimit, {});
  const { plan } = useUserPlan();
  if (limit === undefined || limit === null) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 mb-5 text-sm">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand-ink" aria-hidden="true" />
      <p>
        {plan === "none" ? (
          <>
            You're on the Free plan and see the first {limit} results of each list.{" "}
            <Link to="/dashboard/settings" className="font-medium text-primary underline underline-offset-2">
              Upgrade to Pro
            </Link>{" "}
            to see everything.
          </>
        ) : (
          <>You see the first {limit} results of each list until your Pro payment clears.</>
        )}
      </p>
    </div>
  );
}
