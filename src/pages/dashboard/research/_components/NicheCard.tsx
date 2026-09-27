import { icons, Package, TrendingUp, TrendingDown, Minus, FileText } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";

type Niche = Doc<"niches">;

const directionConfig: Record<string, { icon: typeof TrendingUp; color: string }> = {
  Rising: { icon: TrendingUp, color: "text-green-400" },
  Stable: { icon: Minus, color: "text-blue-400" },
  Declining: { icon: TrendingDown, color: "text-red-400" },
};

function scoreColor(score: number) {
  if (score >= 85) return "text-green-400";
  if (score >= 70) return "text-yellow-400";
  return "text-red-400";
}

export default function NicheCard({ niche, onClick, onGenerateReport }: { niche: Niche; onClick?: () => void; onGenerateReport?: () => void }) {
  const NicheIcon = icons[niche.icon as keyof typeof icons] ?? Package;
  const config = directionConfig[niche.trendDirection];
  const DirIcon = config.icon;

  return (
    <div className="text-left bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all w-full">
      <button onClick={onClick} className="w-full text-left cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <NicheIcon className="w-5 h-5 text-primary" />
          </div>
          <div className={cn("flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted", config.color)}>
            <DirIcon className="w-3 h-3" />
            {niche.trendDirection}
          </div>
        </div>
        <h3 className="font-semibold text-sm mb-1">{niche.name}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">{niche.description}</p>
        <div className="flex items-center justify-between text-xs">
          <div>
            <span className={cn("font-bold", scoreColor(niche.avgAiScore))}>{niche.avgAiScore}</span>
            <span className="text-muted-foreground"> avg score</span>
          </div>
          <div className="text-muted-foreground">{niche.productCount} products</div>
        </div>
      </button>
      {onGenerateReport && (
        <button
          onClick={onGenerateReport}
          className="w-full mt-3 pt-3 border-t border-border flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" />
          AI Niche Report
        </button>
      )}
    </div>
  );
}
