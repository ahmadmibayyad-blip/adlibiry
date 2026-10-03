import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

export type Plan = "agency" | "pro" | "starter" | "none";

// Live: updates as soon as the Stripe webhook records a subscription change.
export function useUserPlan() {
  const result = useQuery(api.billing.myPlan, {});
  const plan: Plan = result ?? "none";
  const isLoading = result === undefined;

  const isPaid = plan !== "none";
  const isPro = plan === "pro" || plan === "agency";
  const isAgency = plan === "agency";

  return { plan, isLoading, isPaid, isPro, isAgency };
}
