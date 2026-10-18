import { FlaskConical, TrendingUp, Trophy } from "lucide-react";
import { adStage, STAGE_INFO, type AdStage } from "@/convex/lib/adStage.ts";
import { cn } from "@/lib/utils.ts";

const STYLE: Record<AdStage, { icon: typeof Trophy; className: string }> = {
  scaling: { icon: TrendingUp, className: "bg-good/90 text-white" },
  winning: { icon: Trophy, className: "bg-warn/90 text-white" },
  testing: { icon: FlaskConical, className: "bg-black/65 text-white" },
};

/** The ad's Scaling / Winning / Testing label (convex/lib/adStage.ts), or nothing. */
export default function AdStageBadge({ ad, className }: { ad: Parameters<typeof adStage>[0]; className?: string }) {
  const stage = adStage(ad);
  if (!stage) return null;
  const { icon: Icon, className: tone } = STYLE[stage];
  return (
    <span
      className={cn("flex items-center gap-1 text-[11px] font-semibold rounded-md px-1.5 py-0.5", tone, className)}
      title={STAGE_INFO[stage].hint}
    >
      <Icon className="w-3 h-3" />
      {STAGE_INFO[stage].label}
    </span>
  );
}
