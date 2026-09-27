import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api.js";
import { useAuth } from "@/hooks/use-auth.ts";

export type Plan = "agency" | "pro" | "starter" | "none";

export function useUserPlan() {
  const { user, isLoading: authLoading } = useAuth();
  const getUserPlan = useAction(api.commerce.getUserPlan);
  const [plan, setPlan] = useState<Plan>("none");
  const [isLoading, setIsLoading] = useState(true);
  // Use ref to avoid stale closure issues
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Defer state update to avoid cascading renders
      const t = setTimeout(() => {
        setPlan("none");
        setIsLoading(false);
      }, 0);
      return () => clearTimeout(t);
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getUserPlan()
      .then((res) => {
        setPlan(res.plan);
        setIsLoading(false);
      })
      .catch(() => {
        setPlan("none");
        setIsLoading(false);
      });
  }, [user, authLoading, getUserPlan]);

  const isPaid = plan !== "none";
  const isPro = plan === "pro" || plan === "agency";
  const isAgency = plan === "agency";

  return { plan, isLoading, isPaid, isPro, isAgency };
}
