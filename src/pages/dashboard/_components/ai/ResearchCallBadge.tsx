import { useQuery } from "convex/react";
import { Microscope } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import type { ResearchCall } from "@/convex/lib/researchReport.ts";
import { cn } from "@/lib/utils.ts";

// The signed-in user's latest AI research verdict on a product (ResearchVerdictCard),
// as a small badge for product lists. One shared subscription for every card on the page.

const CALL_BADGE: Record<ResearchCall, { text: string; style: string }> = {
  test: { text: "Test it", style: "bg-good/15 text-good" },
  research: { text: "Research more", style: "bg-warn/15 text-warn" },
  skip: { text: "Skip", style: "bg-bad/15 text-bad" },
};

export default function ResearchCallBadge({ productId, className }: { productId: Id<"products">; className?: string }) {
  const calls = useQuery(api.researchReports.myCalls);
  const call = calls?.find((c) => c.productId === productId)?.call;
  if (!call) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-semibold rounded-full", CALL_BADGE[call].style, className)}
      title="Your AI research verdict. Open the product to see why."
    >
      <Microscope className="w-3 h-3" aria-hidden="true" />
      {CALL_BADGE[call].text}
    </span>
  );
}
