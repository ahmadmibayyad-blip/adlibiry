import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

// The niches the user sells in (onboarding / Settings). They pre-filter
// Winning Products, Products and Ad Spy; [] when none are chosen.
export function useMyNiches(): { niches: string[]; loaded: boolean } {
  const mine = useQuery(api.onboarding.mine, {});
  return { niches: mine?.niches ?? [], loaded: mine !== undefined };
}
