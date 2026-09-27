import { TrendingUp, TrendingDown, Minus, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";

type Trend = Doc<"trends">;

const directionConfig: Record<string, { icon: typeof TrendingUp; color: string }> = {
  Rising: { icon: TrendingUp, color: "text-green-400" },
  Stable: { icon: Minus, color: "text-blue-400" },
  Declining: { icon: TrendingDown, color: "text-red-400" },
};

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const width = 200;
  const height = 44;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-11" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
      />
    </svg>
  );
}

export default function TrendCard({ trend }: { trend: Trend }) {
  const config = directionConfig[trend.direction];
  const DirIcon = config.icon;
  const topCountry = trend.countryBreakdown[0];

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h3 className="font-semibold text-sm capitalize">{trend.keyword}</h3>
          <div className="text-xs text-muted-foreground">{trend.niche}</div>
        </div>
        <div className={cn("flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-muted shrink-0", config.color)}>
          <DirIcon className="w-3 h-3" />
          {trend.risingPercent > 0 ? "+" : ""}{trend.risingPercent}%
        </div>
      </div>

      <div className="my-3">
        <Sparkline data={trend.weeklyInterest} />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">{trend.insight}</p>

      {topCountry && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe2 className="w-3.5 h-3.5" />
          Top region: <span className="font-medium text-foreground">{topCountry.country}</span>
          <span className="text-muted-foreground">({topCountry.interest}/100)</span>
        </div>
      )}
    </div>
  );
}

export function TrendCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
      <div className="flex justify-between mb-2">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-5 bg-muted rounded-full w-14" />
      </div>
      <div className="h-11 bg-muted rounded my-3" />
      <div className="h-3 bg-muted rounded w-full mb-1" />
      <div className="h-3 bg-muted rounded w-2/3" />
    </div>
  );
}
