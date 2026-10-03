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
            You're seeing the first {limit} results of each list.{" "}
            <Link to="/#pricing" className="font-medium text-primary underline underline-offset-2">
              Start your free trial or pick a plan
            </Link>{" "}
            to see everything once your plan is active.
          </>
        ) : (
          <>
            During your free trial you see the first {limit} results of each list. Once your paid plan starts, you'll see
            everything.
          </>
        )}
      </p>
    </div>
  );
}
